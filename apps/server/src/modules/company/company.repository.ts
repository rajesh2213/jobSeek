import type { PrismaClient, Company } from "@prisma/client";
import { CompanyStatus, Prisma } from "@prisma/client";
import type {
  CompaniesListingInput,
  CompaniesListingSort,
  CompanyListingRow,
} from "./companyListing.types.js";
import { slugifyCompanyName } from "../../utils/slugify.js";
import { getDomainFromUrl, normalizeDomain } from "../../utils/common.js";
import type { JobWithCompany } from "../job/job.repository.js";
import { logger } from "../../utils/logger.js";

const DEBUG_COMPANY_AGG = process.env.DEBUG_COMPANY_AGG === "1";

export interface CreateCompanyInput {
  name: string;
  /** Normalized hostname; optional when creating partial / raw companies. */
  domain?: string;
  careersUrl?: string;
  atsBoardToken?: string;
  atsType?: string;
  /** Optional explicit slug base; otherwise derived from name. */
  slug?: string;
  discoverySource?: string;
}

function nameSearchCondition(q: string): Prisma.Sql {
  const trimmed = q.trim();
  if (!trimmed) return Prisma.empty;
  return Prisma.sql`AND c.name ILIKE ${"%" + trimmed + "%"}`;
}

function listingHavingClause(hiring: boolean, remote: boolean): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (hiring) parts.push(Prisma.sql`COUNT(j.id) >= 1`);
  if (remote) {
    parts.push(
      Prisma.sql`COALESCE(BOOL_OR(j."isRemote" OR j."workType" = 'remote'), false) = true`,
    );
  }
  if (parts.length === 0) return Prisma.empty;
  return Prisma.sql`HAVING ${Prisma.join(parts, " AND ")}`;
}

function listingOrderBy(sort: CompaniesListingSort): Prisma.Sql {
  switch (sort) {
    case "recent":
      return Prisma.sql`sub."lastCrawledAt" DESC NULLS LAST, sub."updatedAt" DESC`;
    case "name":
      return Prisma.sql`sub.name ASC`;
    case "jobs":
    default:
      return Prisma.sql`sub."jobCount" DESC, sub.name ASC`;
  }
}

export function createCompanyRepository(prisma: PrismaClient) {
  async function ensureUniqueSlug(base: string): Promise<string> {
    let candidate = base;
    for (let n = 0; n < 10_000; n += 1) {
      const existing = await prisma.company.findUnique({
        where: { slug: candidate },
      });
      if (!existing) return candidate;
      candidate = `${base}-${n + 1}`;
    }
    throw new Error("ensureUniqueSlug: could not allocate slug");
  }

  return {
    async findMany(): Promise<Company[]> {
      return prisma.company.findMany({
        orderBy: { name: "asc" },
      });
    },

    async findManyPaginated(options: {
      limit: number;
      offset: number;
    }): Promise<Company[]> {
      return prisma.company.findMany({
        orderBy: { name: "asc" },
        take: options.limit,
        skip: options.offset,
      });
    },

    async count(): Promise<number> {
      return prisma.company.count();
    },

    async findByNameQuery(
      query: string,
      options: { limit: number; offset: number },
    ): Promise<Company[]> {
      const q = query.trim();
      if (!q) {
        return prisma.company.findMany({
          orderBy: { name: "asc" },
          take: options.limit,
          skip: options.offset,
        });
      }
      return prisma.company.findMany({
        where: { name: { contains: q, mode: "insensitive" } },
        orderBy: { name: "asc" },
        take: options.limit,
        skip: options.offset,
      });
    },

    async countByNameQuery(query: string): Promise<number> {
      const q = query.trim();
      if (!q) return prisma.company.count();
      return prisma.company.count({
        where: { name: { contains: q, mode: "insensitive" } },
      });
    },

    async findByAtsType(atsType: string): Promise<Company[]> {
      return prisma.company.findMany({
        where: { atsType },
        orderBy: { name: "asc" },
      });
    },

    async findByCareersUrl(careersUrl: string): Promise<Company | null> {
      return prisma.company.findFirst({ where: { careersUrl } });
    },

    async findByName(name: string): Promise<Company | null> {
      return prisma.company.findFirst({
        where: {
          name: { equals: name, mode: "insensitive" },
        },
      });
    },

    async findBySlug(slug: string): Promise<Company | null> {
      return prisma.company.findUnique({
        where: { slug },
      });
    },

    async findByDomain(domain: string): Promise<Company | null> {
      const d = normalizeDomain(domain);
      if (!d) return null;
      return prisma.company.findUnique({
        where: { domain: d },
      });
    },

    async findByAtsBoardToken(atsBoardToken: string): Promise<Company | null> {
      return prisma.company.findFirst({ where: { atsBoardToken } });
    },

    async listCrawlableByAtsType(atsType: string): Promise<Company[]> {
      return prisma.company.findMany({
        where: {
          atsType,
          atsBoardToken: { not: null },
          status: CompanyStatus.ready,
        },
        // Hint for index reads; final order is set in CrawlerService (sort + shuffle + slice).
        orderBy: [
          { score: "desc" },
          { lastCrawledAt: { sort: "asc", nulls: "first" } },
          { name: "asc" },
        ],
      });
    },

    async listCrawlableByAtsTypes(atsTypes: string[]): Promise<Company[]> {
      return prisma.company.findMany({
        where: {
          atsType: { in: atsTypes },
          atsBoardToken: { not: null },
          status: CompanyStatus.ready,
        },
        orderBy: [
          { score: "desc" },
          { lastCrawledAt: { sort: "asc", nulls: "first" } },
          { name: "asc" },
        ],
      });
    },

    async findById(companyId: string): Promise<Company | null> {
      return prisma.company.findUnique({
        where: { id: companyId },
      });
    },

    async findManyNeedingEnrichment(take: number): Promise<Company[]> {
      return prisma.company.findMany({
        where: {
          status: { in: [CompanyStatus.raw, CompanyStatus.enriching] },
          OR: [
            { discoverySource: null },
            { NOT: { discoverySource: { contains: "enrich_exhausted" } } },
          ],
        },
        orderBy: { updatedAt: "asc" },
        take,
      });
    },

    async updateLastCrawledAt(
      companyId: string,
      lastCrawledAt: Date,
    ): Promise<void> {
      await prisma.company.update({
        where: { id: companyId },
        data: { lastCrawledAt },
      });
    },

    async findJobsByCompanyId(
      companyId: string,
      options: { limit: number; offset: number },
    ): Promise<JobWithCompany[]> {
      const rows = await prisma.job.findMany({
        where: {
          companyId,
          canonicalJobId: null,
          status: "ready",
        },
        include: {
          company: { select: { id: true, name: true, slug: true } },
        },
        orderBy: [
          { freshnessScore: "desc" },
          { sourceWeight: "desc" },
        ],
        take: options.limit,
        skip: options.offset,
      });
      return rows as JobWithCompany[];
    },

    async countCanonicalJobsByCompanyId(companyId: string): Promise<number> {
      return prisma.job.count({
        where: {
          companyId,
          canonicalJobId: null,
          status: "ready",
        },
      });
    },

    /**
     * Raw company for discovery / job-ingestion pipelines (domain optional).
     */
    async createRawCompany(input: {
      name: string;
      domain?: string | null;
      discoverySource: string;
    }): Promise<Company> {
      const trimmed = input.name.trim();
      const base = slugifyCompanyName(trimmed);
      const slug = await ensureUniqueSlug(base);
      const normalizedDomain =
        input.domain && normalizeDomain(input.domain)
          ? normalizeDomain(input.domain)
          : null;

      return prisma.company.create({
        data: {
          name: trimmed,
          slug,
          domain: normalizedDomain,
          status: CompanyStatus.raw,
          discoverySource: input.discoverySource,
        },
      });
    },

    /**
     * API / seed: partial companies allowed; status derived from ATS presence.
     */
    async create(input: CreateCompanyInput): Promise<Company> {
      const fromDomain = normalizeDomain(input.domain);
      const fromUrl = getDomainFromUrl(input.careersUrl);
      const normalizedDomain: string | null = fromDomain ?? fromUrl ?? null;

      const base = input.slug
        ? slugifyCompanyName(input.slug)
        : slugifyCompanyName(input.name);
      const slug = await ensureUniqueSlug(base);

      const hasAts = Boolean(input.atsType?.trim() && input.atsBoardToken?.trim());
      const hasLocationHint = Boolean(normalizedDomain || input.careersUrl?.trim());
      const status = hasAts
        ? CompanyStatus.ready
        : hasLocationHint
          ? CompanyStatus.enriching
          : CompanyStatus.raw;

      return prisma.company.create({
        data: {
          name: input.name.trim(),
          slug,
          domain: normalizedDomain,
          careersUrl: input.careersUrl ?? null,
          atsBoardToken: input.atsBoardToken ?? null,
          atsType: input.atsType ?? null,
          status,
          discoverySource: input.discoverySource ?? "api_manual",
        },
      });
    },

    async updateCompanyEnrichmentFields(
      companyId: string,
      data: {
        domain?: string | null;
        careersUrl?: string | null;
        atsType?: string | null;
        atsBoardToken?: string | null;
        status?: CompanyStatus;
      },
    ): Promise<void> {
      await prisma.company.update({
        where: { id: companyId },
        data,
      });
    },

    async countCompaniesListing(input: CompaniesListingInput): Promise<number> {
      const nameCond = nameSearchCondition(input.q);
      const havingSql = listingHavingClause(input.hiring, input.remote);
      const rows = await prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*)::bigint AS count
        FROM (
          SELECT c.id
          FROM "Company" c
          LEFT JOIN "Job" j ON j."companyId" = c.id
            AND j."canonicalJobId" IS NULL
            AND (j."status" = 'ready' OR j."status" IS NULL)
          WHERE 1 = 1
          ${nameCond}
          GROUP BY c.id
          ${havingSql}
        ) AS t
      `;
      return Number(rows[0]?.count ?? 0);
    },

    async listCompaniesDiscovery(input: CompaniesListingInput): Promise<CompanyListingRow[]> {
      const nameCond = nameSearchCondition(input.q);
      const havingSql = listingHavingClause(input.hiring, input.remote);
      const orderSql = listingOrderBy(input.sort);
      const limit = input.limit;
      const offset = input.offset;
      return prisma.$queryRaw<CompanyListingRow[]>`
        SELECT * FROM (
          SELECT
            c.id,
            c.name,
            c.slug,
            c.domain,
            c."logoUrl",
            c."careersUrl",
            c."createdAt",
            c."lastCrawledAt",
            c."updatedAt",
            COUNT(j.id)::int AS "jobCount",
            COALESCE(BOOL_OR(j."isRemote" OR j."workType" = 'remote'), false) AS "hasRemoteJobs"
          FROM "Company" c
          LEFT JOIN "Job" j ON j."companyId" = c.id
            AND j."canonicalJobId" IS NULL
            AND (j."status" = 'ready' OR j."status" IS NULL)
          WHERE 1 = 1
          ${nameCond}
          GROUP BY c.id
          ${havingSql}
        ) AS sub
        ORDER BY ${orderSql}
        LIMIT ${limit}
        OFFSET ${offset}
      `;
    },

    async getCompaniesListingStats(): Promise<{
      totalTracked: number;
      hiringThisWeek: number;
    }> {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const countDistinctHiringCompaniesSql = () =>
        prisma.$queryRaw<[{ c: bigint }]>`
          SELECT COUNT(DISTINCT "companyId")::bigint AS c
          FROM "Job"
          WHERE "canonicalJobId" IS NULL
            AND "status" = 'ready'
            AND "lastSeenAt" >= ${weekAgo}
        `;

      if (!DEBUG_COMPANY_AGG) {
        const totalTracked = await prisma.company.count();
        const aggRows = await countDistinctHiringCompaniesSql();
        return {
          totalTracked,
          hiringThisWeek: Number(aggRows[0]?.c ?? 0),
        };
      }

      let executionMsNew = 0;
      const totalTracked = await prisma.company.count();
      const aggStarted = Date.now();
      const aggRows = await countDistinctHiringCompaniesSql();
      executionMsNew = Date.now() - aggStarted;
      const newCount = Number(aggRows[0]?.c ?? 0);
      let hiringThisWeek = newCount;

      const startedOld = Date.now();
      const legacyDistinct = await prisma.job.findMany({
        where: {
          canonicalJobId: null,
          status: "ready",
          lastSeenAt: { gte: weekAgo },
        },
        distinct: ["companyId"],
        select: { companyId: true },
      });
      const executionMsOld = Date.now() - startedOld;
      const oldCount = legacyDistinct.length;
      const diff = newCount - oldCount;

      if (oldCount !== newCount) {
        logger.warn(
          {
            event: "COMPANY_STATS_SHADOW_MISMATCH",
            oldCount,
            newCount,
            diff,
            executionMsOld,
            executionMsNew,
            weekAgo: weekAgo.toISOString(),
          },
          "COMPANY_STATS_SHADOW_MISMATCH",
        );
        hiringThisWeek = oldCount;
      }

      logger.info(
        {
          event: "COMPANY_STATS_SHADOW_COMPARE",
          oldCount,
          newCount,
          diff,
          executionMsOld,
          executionMsNew,
          weekAgo: weekAgo.toISOString(),
        },
        "COMPANY_STATS_SHADOW_COMPARE",
      );

      return {
        totalTracked,
        hiringThisWeek,
      };
    },
  };
}

export type CompanyRepository = ReturnType<typeof createCompanyRepository>;
