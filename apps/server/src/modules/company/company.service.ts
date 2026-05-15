import type { Company } from "@prisma/client";
import { CompanyStatus } from "@prisma/client";
import type { CompanyRepository } from "./company.repository.js";
import type { CreateCompanyInput } from "./company.repository.js";
import type { CompaniesListingSort, CompanyListingRow } from "./companyListing.types.js";
import type { JobRepository, JobDiscoveryFilters, JobWithCompany } from "../job/job.repository.js";
import type { PaginatedResult } from "../../types/api.js";
import { logger } from "../../utils/logger.js";

const DEBUG_COMPANY_CONCURRENCY = process.env.DEBUG_COMPANY_CONCURRENCY === "1";
import {
  getEnrichCompanyQueue,
  ENRICH_COMPANY_JOB,
  ENRICH_PRIORITY_DEFAULT,
  ENRICH_PRIORITY_JOB_DISCOVERED,
} from "../../queues/enrich-company.queue.js";
import { recordCompanyCreatedFromJob } from "../../services/companyDiscoveryMetrics.service.js";
import { pickCanonicalCompany } from "../../utils/companyCanonical.js";

export class CompanyService {
  constructor(
    private readonly companyRepository: CompanyRepository,
    private readonly jobRepository: JobRepository,
  ) {}

  /**
   * Queue enrichment; lower `priority` runs sooner (see enrich-company queue constants).
   */
  async enqueueCompanyEnrichment(
    companyId: string,
    companyName: string,
    opts?: { priority?: number; jobId?: string },
  ): Promise<void> {
    const queue = getEnrichCompanyQueue();
    const priority = opts?.priority ?? ENRICH_PRIORITY_DEFAULT;
    try {
      await queue.add(
        ENRICH_COMPANY_JOB,
        { companyId, companyName },
        {
          jobId: opts?.jobId ?? `enrich-${companyId}`,
          priority,
          attempts: 2,
          backoff: { type: "exponential", delay: 8000 },
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/already exists|duplicate|Job id already exists/i.test(msg)) {
        return;
      }
      throw err;
    }
  }

  /**
   * Discovery source candidate → raw company row + enrich queue (no domain required).
   */
  async createRawFromDiscovery(input: {
    name: string;
    domain?: string | null;
    discoverySource: string;
  }): Promise<Company> {
    const company = await this.companyRepository.createRawCompany({
      name: input.name,
      domain: input.domain ?? null,
      discoverySource: input.discoverySource,
    });
    await this.enqueueCompanyEnrichment(company.id, company.name);
    return company;
  }

  /**
   * Resolve employer for any job row: prefer existing companyId, else case-insensitive name match, else create raw + enrich queue.
   */
  async ensureCompanyFromJob(params: {
    preferredCompanyId?: string;
    companyName?: string;
  }): Promise<{ companyId: string; created: boolean }> {
    if (params.preferredCompanyId) {
      const existing = await this.companyRepository.findById(params.preferredCompanyId);
      if (existing) {
        return { companyId: existing.id, created: false };
      }
    }

    let name = params.companyName?.trim().replace(/\s+/g, " ") ?? "";
    if (!name) {
      name = "Unknown Company";
    }

    const byName = await this.companyRepository.findByName(name);
    if (byName) {
      return { companyId: byName.id, created: false };
    }

    const company = await this.companyRepository.createRawCompany({
      name,
      discoverySource: "job_ingestion",
    });
    recordCompanyCreatedFromJob();
    await this.enqueueCompanyEnrichment(company.id, company.name, {
      priority: ENRICH_PRIORITY_JOB_DISCOVERED,
      jobId: `enrich-${company.id}`,
    });
    logger.info(
      {
        event: "company_created_from_job",
        companyId: company.id,
        companyName: company.name,
      },
      "company_created_from_job",
    );
    return { companyId: company.id, created: true };
  }

  /**
   * ATS ingest: when multiple companies share the same board token, prefer the canonical row
   * (e.g. api_manual "Reddit" over csv_seed "REDDI").
   */
  async resolveCompanyForAtsIngest(params: {
    preferredCompanyId?: string;
    companyName?: string;
    atsType: string;
    atsBoardToken: string;
  }): Promise<{ companyId: string; created: boolean; switchedCanonical: boolean }> {
    const token = params.atsBoardToken.trim();
    const type = params.atsType.trim();
    const boardMatches =
      token && type ? await this.companyRepository.findManyByAtsBoard(type, token) : [];

    if (boardMatches.length > 0) {
      const canonical = pickCanonicalCompany(boardMatches);
      if (canonical) {
        const preferredId = params.preferredCompanyId?.trim();
        const switched =
          Boolean(preferredId && preferredId !== canonical.id && boardMatches.length > 1);
        if (switched) {
          logger.info(
            {
              event: "ats_company_canonical_switch",
              fromCompanyId: preferredId,
              toCompanyId: canonical.id,
              atsType: type,
              atsBoardToken: token,
            },
            "ats_company_canonical_switch",
          );
        }
        return { companyId: canonical.id, created: false, switchedCanonical: switched };
      }
    }

    const ensured = await this.ensureCompanyFromJob({
      preferredCompanyId: params.preferredCompanyId,
      companyName: params.companyName,
    });
    return { ...ensured, switchedCanonical: false };
  }

  async getAllCompanies(input: {
    page: number;
    limit: number;
  }): Promise<PaginatedResult<Company>> {
    const skip = (input.page - 1) * input.limit;
    const [items, total] = await Promise.all([
      this.companyRepository.findManyPaginated({
        limit: input.limit,
        offset: skip,
      }),
      this.companyRepository.count(),
    ]);
    return {
      items,
      total,
      page: input.page,
      limit: input.limit,
      totalPages: Math.ceil(total / input.limit) || 1,
    };
  }

  async searchCompanies(input: {
    query: string;
    page: number;
    limit: number;
  }): Promise<PaginatedResult<Company>> {
    const skip = (input.page - 1) * input.limit;
    const [items, total] = await Promise.all([
      this.companyRepository.findByNameQuery(input.query, {
        limit: input.limit,
        offset: skip,
      }),
      this.companyRepository.countByNameQuery(input.query),
    ]);
    return {
      items,
      total,
      page: input.page,
      limit: input.limit,
      totalPages: Math.ceil(total / input.limit) || 1,
    };
  }

  /**
   * Public /companies listing: aggregates canonical job counts, sort, light filters, stats.
   */
  async listCompaniesDiscovery(input: {
    q: string;
    sort: CompaniesListingSort;
    hiring: boolean;
    remote: boolean;
    page: number;
    limit: number;
  }): Promise<{
    items: CompanyListingRow[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasMore: boolean;
    stats: { totalTracked: number; hiringThisWeek: number };
  }> {
    const offset = (input.page - 1) * input.limit;
    const filter = {
      q: input.q,
      sort: input.sort,
      hiring: input.hiring,
      remote: input.remote,
      limit: input.limit,
      offset,
    };
    /** Sequential DB work avoids Prisma pool starvation (pgBouncer connection_limit is small). */
    const t0 = Date.now();
    const items = await this.companyRepository.listCompaniesDiscovery(filter);
    if (DEBUG_COMPANY_CONCURRENCY) {
      logger.info(
        { event: "COMPANY_LIST_PHASE_MS", phase: "items", ms: Date.now() - t0 },
        "COMPANY_LIST_PHASE_MS",
      );
    }
    const t1 = Date.now();
    const total = await this.companyRepository.countCompaniesListing(filter);
    if (DEBUG_COMPANY_CONCURRENCY) {
      logger.info(
        { event: "COMPANY_LIST_PHASE_MS", phase: "count", ms: Date.now() - t1 },
        "COMPANY_LIST_PHASE_MS",
      );
    }
    const t2 = Date.now();
    const stats = await this.companyRepository.getCompaniesListingStats();
    if (DEBUG_COMPANY_CONCURRENCY) {
      logger.info(
        { event: "COMPANY_LIST_PHASE_MS", phase: "stats", ms: Date.now() - t2 },
        "COMPANY_LIST_PHASE_MS",
      );
    }
    const totalPages = Math.ceil(total / input.limit) || 1;
    const hasMore = offset + items.length < total;
    return {
      items,
      total,
      page: input.page,
      limit: input.limit,
      totalPages,
      hasMore,
      stats,
    };
  }

  async getCompanyBySlug(slug: string): Promise<Company | null> {
    return this.companyRepository.findBySlug(slug);
  }

  async getCompanyJobs(
    slug: string,
    input: {
      page: number;
      limit: number;
      /** Same semantics as `JobListInput.paginationStride` when metered `limit` is clamped. */
      paginationStride?: number;
      filters?: Omit<JobDiscoveryFilters, "companyId">;
      sort?: "latest" | "salary_desc";
      includeProcessing?: boolean;
    },
  ): Promise<{ company: Company; jobs: PaginatedResult<JobWithCompany> } | null> {
    const company = await this.companyRepository.findBySlug(slug);
    if (!company) return null;

    const filters: JobDiscoveryFilters = {
      ...(input.filters ?? {}),
      companyId: company.id,
    };

    const total = await this.jobRepository.countCanonicalFiltered(filters, {
      includeProcessing: input.includeProcessing,
    });
    const stride =
      typeof input.paginationStride === "number" && input.paginationStride > 0
        ? input.paginationStride
        : input.limit;
    const skip = (input.page - 1) * stride;
    const items = await this.jobRepository.findManyCanonicalFiltered({
      filters,
      limit: input.limit,
      offset: skip,
      sort: input.sort ?? "latest",
      includeProcessing: input.includeProcessing,
    });

    const totalPages = Math.ceil(total / stride) || 1;
    const hasMore = skip + items.length < total;

    return {
      company,
      jobs: {
        items,
        total,
        page: input.page,
        limit: input.limit,
        totalPages,
        hasMore,
      },
    };
  }

  async list(): Promise<Company[]> {
    return this.companyRepository.findMany();
  }

  async listByAtsType(atsType: string): Promise<Company[]> {
    return this.companyRepository.findByAtsType(atsType);
  }

  async listCrawlableByAtsType(atsType: string): Promise<Company[]> {
    return this.companyRepository.listCrawlableByAtsType(atsType);
  }

  async listCrawlableByAtsTypes(atsTypes: string[]): Promise<Company[]> {
    return this.companyRepository.listCrawlableByAtsTypes(atsTypes);
  }

  async create(input: CreateCompanyInput): Promise<Company> {
    const company = await this.companyRepository.create(input);
    if (company.status !== CompanyStatus.ready) {
      await this.enqueueCompanyEnrichment(company.id, company.name).catch((err) => {
        logger.warn(
          { event: "enqueue_enrich_after_create_failed", companyId: company.id, err },
          "Could not enqueue enrichment after company create",
        );
      });
    }
    return company;
  }

  async findByCareersUrl(careersUrl: string): Promise<Company | null> {
    return this.companyRepository.findByCareersUrl(careersUrl);
  }

  async findByName(name: string): Promise<Company | null> {
    return this.companyRepository.findByName(name);
  }

  async findByDomain(domain: string): Promise<Company | null> {
    return this.companyRepository.findByDomain(domain);
  }

  async findByAtsBoardToken(atsBoardToken: string): Promise<Company | null> {
    return this.companyRepository.findByAtsBoardToken(atsBoardToken);
  }

  async findBySlug(slug: string): Promise<Company | null> {
    return this.companyRepository.findBySlug(slug);
  }

  /**
   * Updates `Company.lastCrawledAt` only. Prefer `recordIngestionFinished` on ingest
   * completion so `lastAttemptAt` / success stamps stay aligned; use this for legacy
   * paths that intentionally stamp crawl time outside the worker completion hook.
   */
  async markCrawled(companyId: string, crawledAt: Date): Promise<void> {
    await this.companyRepository.updateLastCrawledAt(companyId, crawledAt);
  }

  async findById(companyId: string): Promise<Company | null> {
    return this.companyRepository.findById(companyId);
  }

  async listCompaniesForEnrichmentBacklog(take: number): Promise<Company[]> {
    return this.companyRepository.findManyNeedingEnrichment(take);
  }
}
