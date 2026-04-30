import type { Job } from "@prisma/client";
import type { JobRepository } from "./job.repository.js";
import type { JobDiscoveryFilters, JobWithCompany } from "./job.repository.js";
import type { NormalizedJob } from "../crawler/crawler.types.js";
import type { PaginatedResult } from "../../types/api.js";
import { Prisma } from "@prisma/client";
import { deduplicateAndInsert } from "../../services/jobDedup.service.js";
import { enrichDedupInput } from "../../utils/jobTaxonomyEnricher.js";

function labelFromHyphenSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export interface JobListInput {
  page: number;
  limit: number;
  /** If set, skips `(page - 1) * limit` and uses this offset instead. */
  offset?: number;
  filters?: JobDiscoveryFilters;
  /** Result ordering; default latest-first by `createdAt`. */
  sort?: "latest" | "salary_desc";
  includeProcessing?: boolean;
}

export class JobService {
  constructor(private readonly jobRepository: JobRepository) {}

  async getById(
    id: string,
    options?: { includeProcessing?: boolean },
  ): Promise<JobWithCompany | null> {
    return this.jobRepository.findById(id, options);
  }

  /**
   * Filter-first listing: taxonomy filters only; ordered by cached freshnessScore + sourceWeight in DB.
   */
  async listRoleSuggestions(): Promise<
    Array<{ slug: string; label: string; count: number }>
  > {
    return this.jobRepository.listRoleSuggestions();
  }

  async listCategoryAggregates(): Promise<
    Array<{ slug: string; label: string; count: number }>
  > {
    const rows = await this.jobRepository.listCategoryAggregates();
    return rows.map((r) => ({
      slug: r.category,
      label: labelFromHyphenSlug(r.category),
      count: r.count,
    }));
  }

  async listSkillAggregates(): Promise<Array<{ slug: string; count: number }>> {
    return this.jobRepository.listSkillAggregates();
  }

  async count(input: {
    filters?: JobDiscoveryFilters;
    includeProcessing?: boolean;
  }): Promise<number> {
    return this.jobRepository.countCanonicalFiltered(input.filters, {
      includeProcessing: input.includeProcessing,
    });
  }

  async list(input: JobListInput): Promise<PaginatedResult<JobWithCompany>> {
    const skip =
      typeof input.offset === "number" && input.offset >= 0
        ? input.offset
        : (input.page - 1) * input.limit;
    const effectivePage = Math.floor(skip / input.limit) + 1;
    const shouldSkipCount = effectivePage === 1;
    const sort = input.sort ?? "latest";
    const items = await this.jobRepository.findManyCanonicalFiltered({
      filters: input.filters,
      limit: input.limit,
      offset: skip,
      sort,
      includeProcessing: input.includeProcessing,
    });
    if (shouldSkipCount) {
      return {
        items,
        total: null,
        page:
          typeof input.offset === "number" && input.offset >= 0
            ? effectivePage
            : input.page,
        limit: input.limit,
        totalPages: 1,
        hasMore: items.length === input.limit,
      };
    }
    const total = await this.jobRepository.countCanonicalFiltered(input.filters, {
      includeProcessing: input.includeProcessing,
    });
    const totalPages = Math.ceil(total / input.limit) || 1;
    const hasMore = skip + items.length < total;

    return {
      items,
      total,
      page:
        typeof input.offset === "number" && input.offset >= 0
          ? effectivePage
          : input.page,
      limit: input.limit,
      totalPages,
      hasMore,
    };
  }

  /**
   * Dedup + canonical merge path for ingestion workers.
   */
  async ingestDeduplicated(
    input: NormalizedJob & { companyDomain: string },
  ): Promise<{ canonical: Job; inserted: boolean }> {
    return deduplicateAndInsert(this.jobRepository, input);
  }

  async createNormalized(
    input: NormalizedJob,
  ): Promise<{ created: boolean }> {
    try {
      const enriched = enrichDedupInput({
        ...input,
        companyDomain: `company:${input.companyId}`,
      });
      await this.jobRepository.create(enriched);
      return { created: true };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        return { created: false };
      }
      throw err;
    }
  }

  async touchLastSeenBySourceUrls(
    sourceUrls: string[],
    seenAt: Date,
  ): Promise<number> {
    return this.jobRepository.updateLastSeenBySourceUrls(sourceUrls, seenAt);
  }
}
