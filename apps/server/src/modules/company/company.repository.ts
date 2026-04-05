import type { PrismaClient, Company } from "@prisma/client";
import { CompanyStatus } from "@prisma/client";
import { slugifyCompanyName } from "../../utils/slugify.js";
import { getDomainFromUrl, normalizeDomain } from "../../utils/common.js";
import type { JobWithCompany } from "../job/job.repository.js";

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
        orderBy: { name: "asc" },
      });
    },

    async listCrawlableByAtsTypes(atsTypes: string[]): Promise<Company[]> {
      return prisma.company.findMany({
        where: {
          atsType: { in: atsTypes },
          atsBoardToken: { not: null },
          status: CompanyStatus.ready,
        },
        orderBy: { name: "asc" },
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
        where: { companyId, canonicalJobId: null },
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
        where: { companyId, canonicalJobId: null },
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
  };
}

export type CompanyRepository = ReturnType<typeof createCompanyRepository>;
