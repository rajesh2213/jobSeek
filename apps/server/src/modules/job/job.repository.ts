import { PrismaClient, Prisma } from "@prisma/client";
import type { Job } from "@prisma/client";

import { enrichJob } from "../enrichment/enrichment.service.js";
import type { DedupJobInput } from "../crawler/crawler.types.js";
import { computeStoredScores } from "../../services/jobRanking.service.js";
import { computeJobExpiresAt } from "../../services/jobRetentionPolicy.service.js";
import { isValidJobUrl } from "../../utils/url.js";
import { logger } from "../../utils/logger.js";
import { expandLocationFilter, getRegions } from "../../utils/locationResolver.js";
import { computeLocationPatchFromReingest } from "../../services/jobCanonical.service.js";
import { recordStatusTransition } from "../../services/jobStatusMetrics.service.js";
import {
  LISTING_EXCLUDED_ROLE_SLUGS,
  ROLE_SUGGEST_EXTRA_EXCLUDED,
} from "./jobListing.constants.js";

export type JobStatus = "processing" | "ready" | "failed";

const JOB_STATUS_PROCESSING: JobStatus = "processing";
const JOB_STATUS_READY: JobStatus = "ready";
const JOB_STATUS_FAILED: JobStatus = "failed";

function maxMergedSkills(): number {
  const n = Number(process.env.MAX_MERGED_SKILLS ?? "60");
  return Math.max(1, Math.min(75, Number.isFinite(n) ? n : 60));
}

/** Union taxonomy + parsed tech; capped to avoid search/ranking bloat. */
function mergeJobSkillsList(taxonomySkills: string[], techStack: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of taxonomySkills) {
    const t = s.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= max) return out;
  }
  for (const s of techStack) {
    const t = s.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= max) return out;
  }
  return out;
}

function safeApplyUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return isValidJobUrl(url) ? url : null;
}

const PARSED_DESCRIPTION_SCORE_KEYS = [
  "position",
  "responsibility",
  "responsibilities",
  "requirement",
  "requirements",
  "experience",
  "benefit",
  "benefits",
  "contact",
  "other",
] as const;

const BOILERPLATE_LINE_RE = /^(apply|click|learn more)$/i;

/**
 * Weighted score: line count + section coverage. Capped for stability.
 * Exported for unit tests.
 */
export function scoreParsedDescription(parsed: unknown): number {
  if (!parsed || typeof parsed !== "object") return 0;
  const o = parsed as Record<string, unknown>;

  let totalLines = 0;
  let sectionCount = 0;

  for (const key of PARSED_DESCRIPTION_SCORE_KEYS) {
    const arr = o[key];
    if (Array.isArray(arr) && arr.length > 0) {
      sectionCount++;
      const lineWeight = key === "other" ? 0.5 : 1;
      for (const line of arr) {
        if (
          typeof line === "string" &&
          line.length > 12 &&
          !BOILERPLATE_LINE_RE.test(line.trim())
        ) {
          totalLines += lineWeight;
        }
      }
    }
  }

  const score = totalLines + sectionCount * 2;
  return Math.min(score, 100);
}

/** Non-empty section buckets (same keys as scoring). Tie-breaker for equal scores. */
export function countPopulatedSections(parsed: unknown): number {
  if (!parsed || typeof parsed !== "object") return 0;
  const o = parsed as Record<string, unknown>;
  let n = 0;
  for (const key of PARSED_DESCRIPTION_SCORE_KEYS) {
    const arr = o[key];
    if (Array.isArray(arr) && arr.length > 0) n++;
  }
  return n;
}

/** True when incoming parse should replace stored parse (never downgrade). */
export function shouldReplaceParsedDescription(
  existingScore: number,
  newScore: number,
  existingSectionCount = 0,
  newSectionCount = 0,
): boolean {
  return (
    newScore > existingScore ||
    (existingScore === 0 && newScore > 0) ||
    (newScore === existingScore && newSectionCount > existingSectionCount)
  );
}

function jsonObjectOrEmpty(
  value: Prisma.JsonValue | null | undefined,
): Record<string, unknown> {
  if (
    value !== null &&
    value !== undefined &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

/**
 * Filter-first discovery (taxonomy slugs + ISO country).
 * Exported for parity/integration tests against {@link buildDiscoveryWhereSql}.
 */
export interface JobDiscoveryFilters {
  role?: string;
  roles?: string[];
  roleTerms?: string[];
  /** Match if job has any of these skill slugs. */
  skills?: string[];
  /** ISO 3166-1 alpha-2 (preferred) or resolved from slug via API. */
  country?: string;
  countries?: string[];
  locationTerms?: string[];
  category?: string;
  /** Multi-select categories (OR). When set, overrides `category`. */
  categories?: string[];
  /** Legacy: when true and `workType` unset, treated as remote. */
  isRemote?: boolean;
  workType?: "remote" | "onsite" | "hybrid";
  workTypes?: Array<"remote" | "onsite" | "hybrid">;
  experienceLevel?: "junior" | "mid" | "senior";
  postedWithin?: "24h" | "3d" | "1w" | "1m";
  /** Exclusive lower bound on listing age (COALESCE(postedAt, createdAt)). */
  postedAfter?: Date;
  minSalary?: number;
  companyId?: string;
  /**
   * Region name (e.g. Asia), ISO country code, or city text — resolved server-side
   * via `locationRegion`, `expandLocationFilter`, or `locationCity` contains.
   */
  location?: string;
  /**
   * Multiple `?locations=` tokens — OR semantics; each token uses the same rules as `location`.
   */
  locationTokens?: string[];
  /** Internal/admin bypass for processing/failed visibility filters. */
  includeProcessing?: boolean;
}

export interface JobWithCompany extends Job {
  company: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    domain: string | null;
    careersUrl: string | null;
    _count?: { jobs: number };
  };
}

function readyStatusWhere(includeProcessing?: boolean): Prisma.JobWhereInput | null {
  if (includeProcessing) return null;
  return ({
    OR: [{ status: JOB_STATUS_READY }, { status: null }],
  } as unknown) as Prisma.JobWhereInput;
}

function readyStatusSql(includeProcessing?: boolean): Prisma.Sql | null {
  if (includeProcessing) return null;
  return Prisma.sql`(j."status" = ${JOB_STATUS_READY} OR j."status" IS NULL)`;
}

/** Match stored country when legacy `country` was populated before `locationCountry`. */
function whereResolvedCountryIn(codes: string[]): Prisma.JobWhereInput {
  return {
    OR: [
      { locationCountry: { in: codes } },
      {
        AND: [{ locationCountry: "UNKNOWN" }, { country: { in: codes } }],
      },
    ],
  };
}

function postedSince(key: "24h" | "3d" | "1w" | "1m"): Date {
  const now = Date.now();
  const ms = {
    "24h": 24 * 60 * 60 * 1000,
    "3d": 3 * 24 * 60 * 60 * 1000,
    "1w": 7 * 24 * 60 * 60 * 1000,
    "1m": 30 * 24 * 60 * 60 * 1000,
  }[key];
  return new Date(now - ms);
}

function roleLabelFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function whereForLocationToken(locQ: string): Prisma.JobWhereInput {
  const regionsList = getRegions();
  const regionHit = regionsList.find((r) => r.toLowerCase() === locQ.toLowerCase());
  if (regionHit) {
    const regionCodes = expandLocationFilter(regionHit);
    return {
      OR: [
        { locationRegion: regionHit },
        {
          AND: [
            { OR: [{ locationRegion: null }, { locationRegion: "" }] },
            whereResolvedCountryIn(regionCodes),
          ],
        },
      ],
    };
  }
  const codes = expandLocationFilter(locQ);
  if (codes.length === 1) {
    return whereResolvedCountryIn([codes[0]!]);
  }
  if (codes.length > 1) {
    return whereResolvedCountryIn(codes);
  }
  return {
    locationCity: { contains: locQ, mode: "insensitive" },
  };
}

function sqlForLocationToken(locQ: string): Prisma.Sql {
  const regionsList = getRegions();
  const regionHit = regionsList.find((r) => r.toLowerCase() === locQ.toLowerCase());
  if (regionHit) {
    const regionCodes = expandLocationFilter(regionHit);
    return Prisma.sql`(
      j."locationRegion" = ${regionHit}
      OR (
        (j."locationRegion" IS NULL OR j."locationRegion" = '')
        AND (${sqlResolvedCountryIn(regionCodes)})
      )
    )`;
  }
  const codes = expandLocationFilter(locQ);
  if (codes.length === 1) {
    return sqlResolvedCountryIn([codes[0]!]);
  }
  if (codes.length > 1) {
    return sqlResolvedCountryIn(codes);
  }
  return Prisma.sql`j."locationCity" ILIKE ${`%${locQ}%`}`;
}

/** Prisma `where` for canonical discovery — keep in sync with `buildDiscoveryWhereSql`. */
export function buildDiscoveryWhere(
  filters?: JobDiscoveryFilters,
  options?: { includeProcessing?: boolean },
): Prisma.JobWhereInput {
  const includeProcessing =
    options?.includeProcessing ?? filters?.includeProcessing ?? false;
  const and: Prisma.JobWhereInput[] = [
    { canonicalJobId: null },
    { role: { notIn: [...LISTING_EXCLUDED_ROLE_SLUGS] } },
  ];
  const statusFilter = readyStatusWhere(includeProcessing);
  if (statusFilter) and.push(statusFilter);

  if (!filters) return { AND: and };

  if (filters.roleTerms !== undefined && filters.roleTerms.length > 0) {
    and.push({
      OR: filters.roleTerms.map((term) => ({
        title: { contains: term, mode: "insensitive" },
      })),
    });
  } else if (filters.roles !== undefined && filters.roles.length > 0) {
    and.push({
      OR: filters.roles.map((term) => ({
        title: { contains: term, mode: "insensitive" },
      })),
    });
  } else if (filters.role !== undefined && filters.role !== "") {
    and.push({ title: { contains: filters.role, mode: "insensitive" } });
  }

  const locationTokens = filters.locationTokens?.filter((t) => t.trim().length > 0);
  if (locationTokens !== undefined && locationTokens.length > 0) {
    and.push({
      OR: locationTokens.map((t) => whereForLocationToken(t.trim())),
    });
  } else {
    const locQ = filters.location?.trim();
    if (locQ) {
      and.push(whereForLocationToken(locQ));
    }
  }

  const hasStructuredLocation =
    (locationTokens?.length ?? 0) > 0 || Boolean(filters.location?.trim());
  const locationFilterValues =
    !hasStructuredLocation && filters.countries?.length
      ? filters.countries
      : !hasStructuredLocation && filters.country
        ? [filters.country]
        : [];
  if (locationFilterValues.length > 0) {
    and.push(whereResolvedCountryIn(locationFilterValues));
  } else if (
    !hasStructuredLocation &&
    filters.locationTerms !== undefined &&
    filters.locationTerms.length > 0
  ) {
    and.push({
      OR: filters.locationTerms.map((loc) => ({
        OR: [
          { country: { contains: loc, mode: "insensitive" } },
          { locationCity: { contains: loc, mode: "insensitive" } },
        ],
      })),
    });
  }
  if (filters.categories !== undefined && filters.categories.length > 0) {
    and.push({ category: { in: filters.categories } });
  } else if (filters.category !== undefined && filters.category !== "") {
    and.push({ category: filters.category });
  }
  if (filters.workTypes !== undefined && filters.workTypes.length > 0) {
    and.push({ workType: { in: filters.workTypes } });
  } else if (filters.workType !== undefined) {
    and.push({ workType: filters.workType });
  } else if (filters.isRemote === true) {
    and.push({ workType: "remote" });
  }
  if (filters.experienceLevel !== undefined) {
    and.push({ experienceLevel: filters.experienceLevel });
  }
  if (filters.postedWithin !== undefined) {
    const since = postedSince(filters.postedWithin);
    and.push({
      OR: [
        { postedAt: { gte: since } },
        { AND: [{ postedAt: null }, { createdAt: { gte: since } }] },
      ],
    });
  }
  if (filters.postedAfter !== undefined) {
    const since = filters.postedAfter;
    and.push({
      OR: [
        { postedAt: { gt: since } },
        { AND: [{ postedAt: null }, { createdAt: { gt: since } }] },
      ],
    });
  }
  if (filters.companyId !== undefined && filters.companyId !== "") {
    and.push({ companyId: filters.companyId });
  }
  if (filters.skills !== undefined && filters.skills.length > 0) {
    and.push({ skills: { hasSome: filters.skills } });
  }
  if (filters.minSalary !== undefined) {
    and.push({ salaryMin: { gte: filters.minSalary } });
  }

  return { AND: and };
}

/** `WHERE` fragment for table alias `j` — keep in sync with `buildDiscoveryWhere`. */
function sqlResolvedCountryIn(codes: string[]): Prisma.Sql {
  const list = Prisma.join(codes.map((c) => Prisma.sql`${c}`));
  return Prisma.sql`(
    j."locationCountry" IN (${list})
    OR (j."locationCountry" = 'UNKNOWN' AND j.country IN (${list}))
  )`;
}

/** Raw SQL `WHERE` for table `j` — keep in sync with `buildDiscoveryWhere`. */
export function buildDiscoveryWhereSql(
  filters?: JobDiscoveryFilters,
  options?: { includeProcessing?: boolean },
): Prisma.Sql {
  const includeProcessing =
    options?.includeProcessing ?? filters?.includeProcessing ?? false;
  const excluded = Prisma.join(
    LISTING_EXCLUDED_ROLE_SLUGS.map((s) => Prisma.sql`${s}`),
  );
  const parts: Prisma.Sql[] = [
    Prisma.sql`j."canonicalJobId" IS NULL`,
    Prisma.sql`j.role NOT IN (${excluded})`,
  ];
  const statusFilter = readyStatusSql(includeProcessing);
  if (statusFilter) parts.push(statusFilter);

  if (!filters) {
    return Prisma.join(parts, " AND ");
  }

  if (filters.roleTerms !== undefined && filters.roleTerms.length > 0) {
    parts.push(
      Prisma.sql`(${Prisma.join(
        filters.roleTerms.map(
          (term) => Prisma.sql`j.title ILIKE ${`%${term}%`}`,
        ),
        " OR ",
      )})`,
    );
  } else if (filters.roles !== undefined && filters.roles.length > 0) {
    parts.push(
      Prisma.sql`(${Prisma.join(
        filters.roles.map((term) => Prisma.sql`j.title ILIKE ${`%${term}%`}`),
        " OR ",
      )})`,
    );
  } else if (filters.role !== undefined && filters.role !== "") {
    parts.push(Prisma.sql`j.title ILIKE ${`%${filters.role}%`}`);
  }

  const sqlLocationTokens = filters.locationTokens?.filter((t) => t.trim().length > 0);
  if (sqlLocationTokens !== undefined && sqlLocationTokens.length > 0) {
    parts.push(
      Prisma.sql`(${Prisma.join(
        sqlLocationTokens.map((t) => sqlForLocationToken(t.trim())),
        " OR ",
      )})`,
    );
  } else {
    const locQ = filters.location?.trim();
    if (locQ) {
      parts.push(sqlForLocationToken(locQ));
    }
  }

  const hasStructuredLocationSql =
    (sqlLocationTokens?.length ?? 0) > 0 || Boolean(filters.location?.trim());
  const locationFilterValuesSql =
    !hasStructuredLocationSql && filters.countries?.length
      ? filters.countries
      : !hasStructuredLocationSql && filters.country
        ? [filters.country]
        : [];
  if (locationFilterValuesSql.length > 0) {
    parts.push(sqlResolvedCountryIn(locationFilterValuesSql));
  } else if (
    !hasStructuredLocationSql &&
    filters.locationTerms !== undefined &&
    filters.locationTerms.length > 0
  ) {
    parts.push(
      Prisma.sql`(${Prisma.join(
        filters.locationTerms.map(
          (loc) =>
            Prisma.sql`(j.country ILIKE ${`%${loc}%`} OR j."locationCity" ILIKE ${`%${loc}%`})`,
        ),
        " OR ",
      )})`,
    );
  }
  if (filters.categories !== undefined && filters.categories.length > 0) {
    parts.push(
      Prisma.sql`j.category IN (${Prisma.join(
        filters.categories.map((c) => Prisma.sql`${c}`),
      )})`,
    );
  } else if (filters.category !== undefined && filters.category !== "") {
    parts.push(Prisma.sql`j.category = ${filters.category}`);
  }
  if (filters.workTypes !== undefined && filters.workTypes.length > 0) {
    parts.push(
      Prisma.sql`j."workType" IN (${Prisma.join(
        filters.workTypes.map((w) => Prisma.sql`${w}`),
      )})`,
    );
  } else if (filters.workType !== undefined) {
    parts.push(Prisma.sql`j."workType" = ${filters.workType}`);
  } else if (filters.isRemote === true) {
    parts.push(Prisma.sql`j."workType" = 'remote'`);
  }
  if (filters.experienceLevel !== undefined) {
    parts.push(Prisma.sql`j."experienceLevel" = ${filters.experienceLevel}`);
  }
  if (filters.postedWithin !== undefined) {
    const since = postedSince(filters.postedWithin);
    parts.push(
      Prisma.sql`(j."postedAt" >= ${since} OR (j."postedAt" IS NULL AND j."createdAt" >= ${since}))`,
    );
  }
  if (filters.postedAfter !== undefined) {
    const since = filters.postedAfter;
    parts.push(
      Prisma.sql`(j."postedAt" > ${since} OR (j."postedAt" IS NULL AND j."createdAt" > ${since}))`,
    );
  }
  if (filters.companyId !== undefined && filters.companyId !== "") {
    parts.push(Prisma.sql`j."companyId" = ${filters.companyId}`);
  }
  if (filters.skills !== undefined && filters.skills.length > 0) {
    parts.push(
      Prisma.sql`j.skills && ARRAY[${Prisma.join(
        filters.skills.map((s) => Prisma.sql`${s}`),
      )}]::text[]`,
    );
  }
  if (filters.minSalary !== undefined) {
    parts.push(Prisma.sql`j."salaryMin" >= ${filters.minSalary}`);
  }

  return Prisma.join(parts, " AND ");
}

export function createJobRepository(prisma: PrismaClient) {
  function buildBaseJobData(input: DedupJobInput) {
    const now = new Date();
    /** Ingest-time proxy for DB `createdAt`; `computeStoredScores` ages from COALESCE(postedAt, createdAt). */
    const scores = computeStoredScores(input.source, input.postedAt ?? null, now);
    const expiresAt = computeJobExpiresAt({
      source: input.source,
      lastSeenAt: now,
    });
    const workType =
      input.workType ??
      (input.isRemote ? "remote" : "onsite");
    return {
      title: input.title,
      companyId: input.companyId,
      country: input.country,
      locationCity: input.locationCity ?? null,
      locationState: input.locationState ?? null,
      locationCountry: input.locationCountry ?? input.country,
      locationRegion: input.locationRegion ?? null,
      category: input.category,
      isRemote: input.isRemote,
      workType,
      experienceLevel: input.experienceLevel ?? null,
      description: input.description ?? null,
      source: input.source,
      sourceUrl: input.sourceUrl,
      applyUrl: safeApplyUrl(input.applyUrl),
      postedAt: input.postedAt ?? null,
      lastSeenAt: now,
      expiresAt,
      isActive: true,
      freshnessScore: scores.freshnessScore,
      sourceWeight: scores.sourceWeight,
      atsJobId: input.atsJobId ?? null,
      role: input.role,
      skills: input.skills,
      salaryMin: input.salaryMin,
      ...(input.hasMultipleLocations
        ? {
            enriched: { hasMultipleLocations: true } as Prisma.InputJsonValue,
          }
        : {}),
    };
  }

  return {
    async findBySourceUrl(sourceUrl: string): Promise<Job | null> {
      return prisma.job.findUnique({ where: { sourceUrl } });
    },

    async findByIdRaw(id: string): Promise<Job | null> {
      return prisma.job.findUnique({ where: { id } });
    },

    async resolveCanonicalJob(job: Job): Promise<Job> {
      if (!job.canonicalJobId) return job;
      const c = await prisma.job.findUnique({ where: { id: job.canonicalJobId } });
      if (!c) {
        throw new Error(`Missing canonical job for duplicate ${job.id}`);
      }
      return c;
    },

    async findCanonicalsByFingerprint(fingerprint: string): Promise<Job[]> {
      return prisma.job.findMany({
        where: { fingerprint, canonicalJobId: null },
      });
    },

    async findDuplicatesByCanonicalId(canonicalId: string): Promise<Job[]> {
      return prisma.job.findMany({
        where: { canonicalJobId: canonicalId },
      });
    },

    async countCanonicalFiltered(
      filters?: JobDiscoveryFilters,
      options?: { includeProcessing?: boolean },
    ): Promise<number> {
      const whereSql = buildDiscoveryWhereSql(filters, {
        includeProcessing: options?.includeProcessing ?? false,
      });
      const rows = await prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*)::bigint AS c FROM "Job" j WHERE ${whereSql}
      `;
      return Number(rows[0]?.c ?? 0);
    },

    async listRoleSuggestions(): Promise<
      Array<{ slug: string; label: string; count: number }>
    > {
      const excluded = [...LISTING_EXCLUDED_ROLE_SLUGS, ...ROLE_SUGGEST_EXTRA_EXCLUDED];
      const rows = await prisma.$queryRaw<{ role: string; count: bigint }[]>`
        SELECT j.role, COUNT(*)::bigint AS count
        FROM "Job" j
        WHERE j."canonicalJobId" IS NULL
          AND (j."status" = ${JOB_STATUS_READY} OR j."status" IS NULL)
          AND j.role NOT IN (${Prisma.join(
            excluded.map((e) => Prisma.sql`${e}`),
          )})
          AND LENGTH(j.role) > 3
          AND j.role NOT ILIKE '%career%'
          AND j.role NOT ILIKE '%benefit%'
          AND j.role NOT ILIKE '%location%'
        GROUP BY j.role
        ORDER BY count DESC
        LIMIT 200
      `;
      return rows.map((r) => ({
        slug: r.role,
        label: roleLabelFromSlug(r.role),
        count: Number(r.count),
      }));
    },

    async listCategoryAggregates(): Promise<
      Array<{ category: string; count: number }>
    > {
      const rows = await prisma.$queryRaw<{ category: string; count: bigint }[]>`
        SELECT j.category, COUNT(*)::bigint AS count
        FROM "Job" j
        WHERE j."canonicalJobId" IS NULL
          AND (j."status" = ${JOB_STATUS_READY} OR j."status" IS NULL)
          AND j.role NOT IN (${Prisma.join(
            LISTING_EXCLUDED_ROLE_SLUGS.map((e) => Prisma.sql`${e}`),
          )})
          AND j.category <> 'other'
        GROUP BY j.category
        ORDER BY count DESC
      `;
      return rows.map((r) => ({
        category: r.category,
        count: Number(r.count),
      }));
    },

    async listSkillAggregates(): Promise<Array<{ slug: string; count: number }>> {
      const rows = await prisma.$queryRaw<{ skill: string; count: bigint }[]>`
        SELECT LOWER(TRIM(s.skill)) AS skill, COUNT(*)::bigint AS count
        FROM "Job" j
        CROSS JOIN LATERAL unnest(j.skills) AS s(skill)
        WHERE j."canonicalJobId" IS NULL
          AND (j."status" = ${JOB_STATUS_READY} OR j."status" IS NULL)
          AND j.role NOT IN (${Prisma.join(
            LISTING_EXCLUDED_ROLE_SLUGS.map((e) => Prisma.sql`${e}`),
          )})
          AND array_length(j.skills, 1) IS NOT NULL
          AND array_length(j.skills, 1) > 0
        GROUP BY LOWER(TRIM(s.skill))
        ORDER BY count DESC
        LIMIT 400
      `;
      return rows.map((r) => ({
        slug: r.skill,
        count: Number(r.count),
      }));
    },

    /**
     * Canonical jobs only; filter-first.
     * Latest: `ORDER BY COALESCE("postedAt","createdAt") DESC` (listing age, not crawl-only).
     * Salary: salary floor desc, then `createdAt` desc.
     */
    async findManyCanonicalFiltered(options: {
      filters?: JobDiscoveryFilters;
      limit: number;
      offset: number;
      sort?: "latest" | "salary_desc";
      includeProcessing?: boolean;
    }): Promise<JobWithCompany[]> {
      const sort = options.sort ?? "latest";
      const companyInclude = {
        select: {
          id: true,
          name: true,
          slug: true,
          logoUrl: true,
          domain: true,
          careersUrl: true,
          _count: { select: { jobs: true } },
        },
      };

      if (sort === "latest") {
        const whereSql = buildDiscoveryWhereSql(options.filters, {
          includeProcessing: options.includeProcessing ?? false,
        });
        const idRows = await prisma.$queryRaw<{ id: string }[]>`
          SELECT j.id FROM "Job" j
          WHERE ${whereSql}
          ORDER BY COALESCE(j."postedAt", j."createdAt") DESC
          LIMIT ${options.limit} OFFSET ${options.offset}
        `;
        const ids = idRows.map((r) => r.id);
        if (ids.length === 0) return [];
        const jobs = await prisma.job.findMany({
          where: { id: { in: ids } },
          include: { company: companyInclude },
        });
        const order = new Map(ids.map((id, i) => [id, i]));
        jobs.sort((a, b) => (order.get(a.id)! - order.get(b.id)!));
        return jobs as JobWithCompany[];
      }

      // Salary: same filter SQL as "latest" (avoids Prisma `where` + `orderBy` nulls issues), then
      // `ORDER BY salary NULLS LAST` (Postgres) so unknown salaries sort after high floors.
      const whereSql = buildDiscoveryWhereSql(options.filters, {
        includeProcessing: options.includeProcessing ?? false,
      });
      const idRows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT j.id FROM "Job" j
        WHERE ${whereSql}
        ORDER BY j."salaryMin" DESC NULLS LAST, j."createdAt" DESC
        LIMIT ${options.limit} OFFSET ${options.offset}
      `;
      const ids = idRows.map((r) => r.id);
      if (ids.length === 0) return [];
      const jobs = await prisma.job.findMany({
        where: { id: { in: ids } },
        include: { company: companyInclude },
      });
      const order = new Map(ids.map((id, i) => [id, i]));
      jobs.sort((a, b) => (order.get(a.id)! - order.get(b.id)!));
      return jobs as JobWithCompany[];
    },

    async findById(
      id: string,
      options?: { includeProcessing?: boolean },
    ): Promise<JobWithCompany | null> {
      const includeProcessing = options?.includeProcessing ?? false;
      const job = await prisma.job.findUnique({
        where: { id },
        include: {
          company: {
            select: {
              id: true,
              name: true,
              slug: true,
              logoUrl: true,
              domain: true,
              careersUrl: true,
              _count: { select: { jobs: true } },
            },
          },
        },
      });
      if (!job) return null;
      const targetId = job.canonicalJobId ?? job.id;
      if (targetId === job.id) {
        if (includeProcessing) return job as JobWithCompany;
        const status = (job as unknown as { status?: string | null }).status ?? null;
        const parsedDescription = (
          job as unknown as { parsedDescription?: unknown }
        ).parsedDescription;
        const effectiveReady =
          status === JOB_STATUS_READY || status === null || parsedDescription != null;
        return effectiveReady ? (job as JobWithCompany) : null;
      }
      const canonical = await prisma.job.findUnique({
        where: { id: targetId },
        include: {
          company: {
            select: {
              id: true,
              name: true,
              slug: true,
              logoUrl: true,
              domain: true,
              careersUrl: true,
              _count: { select: { jobs: true } },
            },
          },
        },
      });
      if (!canonical) return null;
      if (includeProcessing) return canonical as JobWithCompany;
      const status = (canonical as unknown as { status?: string | null }).status ?? null;
      const parsedDescription = (
        canonical as unknown as { parsedDescription?: unknown }
      ).parsedDescription;
      const effectiveReady =
        status === JOB_STATUS_READY || status === null || parsedDescription != null;
      return effectiveReady ? (canonical as JobWithCompany) : null;
    },

    async create(input: DedupJobInput): Promise<Job> {
      const seenAt = new Date();
      return prisma.job.upsert({
        where: { sourceUrl: input.sourceUrl },
        update: {
          updatedAt: seenAt,
          lastSeenAt: seenAt,
          expiresAt: computeJobExpiresAt({
            source: input.source,
            lastSeenAt: seenAt,
          }),
          isActive: true,
        } as Prisma.JobUpdateInput,
        create: {
          ...buildBaseJobData(input),
          fingerprintVersion: "v2",
        },
      });
    },

    async createCanonicalJob(
      input: DedupJobInput & { fingerprint: string; fingerprintVersion: "v2" },
    ): Promise<Job> {
      const existing = await prisma.job.findUnique({
        where: { sourceUrl: input.sourceUrl },
      });
      if (existing) {
        logger.info(
          { event: "job_duplicate_sourceUrl", sourceUrl: input.sourceUrl },
          "job_duplicate_sourceUrl",
        );
        return existing;
      }
      try {
        return await prisma.job.create({
          data: {
            ...buildBaseJobData(input),
            fingerprint: input.fingerprint,
            fingerprintVersion: input.fingerprintVersion,
            canonicalJobId: null,
          },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          logger.info(
            { event: "job_duplicate_sourceUrl", sourceUrl: input.sourceUrl },
            "job_duplicate_sourceUrl",
          );
          const existing = await prisma.job.findUnique({
            where: { sourceUrl: input.sourceUrl },
          });
          if (existing) return existing;
        }
        throw err;
      }
    },

    async createDuplicateJob(
      input: DedupJobInput & {
        fingerprint: string;
        fingerprintVersion: "v2";
        canonicalJobId: string;
      },
    ): Promise<Job> {
      const existing = await prisma.job.findUnique({
        where: { sourceUrl: input.sourceUrl },
      });
      if (existing) {
        logger.info(
          { event: "job_duplicate_sourceUrl", sourceUrl: input.sourceUrl },
          "job_duplicate_sourceUrl",
        );
        return existing;
      }
      try {
        return await prisma.job.create({
          data: {
            ...buildBaseJobData(input),
            fingerprint: input.fingerprint,
            fingerprintVersion: input.fingerprintVersion,
            canonicalJobId: input.canonicalJobId,
          },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          logger.info(
            { event: "job_duplicate_sourceUrl", sourceUrl: input.sourceUrl },
            "job_duplicate_sourceUrl",
          );
          const existing = await prisma.job.findUnique({
            where: { sourceUrl: input.sourceUrl },
          });
          if (existing) return existing;
        }
        throw err;
      }
    },

    async updateCanonicalById(
      id: string,
      data: {
        title: string;
        description: string | null;
        country: string | null;
        category: string | null;
        isRemote: boolean;
        postedAt: Date | null;
      },
    ): Promise<void> {
      await prisma.job.update({
        where: { id },
        data: {
          title: data.title,
          description: data.description,
          country: data.country ?? "UNKNOWN",
          category: data.category ?? "other",
          isRemote: data.isRemote,
          postedAt: data.postedAt,
        },
      });
    },

    async updateCanonicalAggregation(
      id: string,
      data: {
        title: string;
        description: string | null;
        country: string | null;
        locationCountry: string;
        locationCity: string | null;
        locationState: string | null;
        locationRegion: string | null;
        category: string | null;
        isRemote: boolean;
        workType: string;
        experienceLevel: string | null;
        postedAt: Date | null;
        applyUrl: string | null;
        freshnessScore: number;
        sourceWeight: number;
        source: string;
        role: string;
        skills: string[];
        salaryMin: number | null;
      },
    ): Promise<void> {
      const row = await prisma.job.findUnique({ where: { id } });
      if (!row) return;
      await prisma.job.update({
        where: { id },
        data: {
          title: data.title,
          description: data.description,
          country: data.country ?? "UNKNOWN",
          locationCountry: data.locationCountry,
          locationCity: data.locationCity,
          locationState: data.locationState,
          locationRegion: data.locationRegion,
          category: data.category ?? "other",
          isRemote: data.isRemote,
          workType: data.workType,
          experienceLevel: data.experienceLevel,
          postedAt: data.postedAt,
          applyUrl: data.applyUrl,
          freshnessScore: data.freshnessScore,
          sourceWeight: data.sourceWeight,
          source: data.source,
          role: data.role,
          skills: data.skills,
          salaryMin: data.salaryMin,
        },
      });
    },

    /**
     * Backfill structured location when re-ingesting an existing `sourceUrl` row with richer
     * normalized location than the DB (e.g. ATS path was fixed or older rows predate fields).
     */
    async mergeStructuredLocationFromReingest(
      id: string,
      incoming: Pick<
        DedupJobInput,
        | "country"
        | "locationCountry"
        | "locationCity"
        | "locationState"
        | "locationRegion"
      >,
    ): Promise<boolean> {
      const row = await prisma.job.findUnique({ where: { id } });
      if (!row) return false;
      const patch = computeLocationPatchFromReingest(row, incoming);
      logger.info(
        {
          event: "location_merge",
          jobId: id,
          existing: {
            country: row.country,
            locationCountry: row.locationCountry,
            locationCity: row.locationCity,
            locationState: row.locationState,
            locationRegion: row.locationRegion,
          },
          incoming: {
            country: incoming.country,
            locationCountry: incoming.locationCountry,
            locationCity: incoming.locationCity,
            locationState: incoming.locationState,
            locationRegion: incoming.locationRegion,
          },
          applied: patch !== null,
        },
        "location_merge",
      );
      if (!patch) return false;
      await prisma.job.update({
        where: { id },
        data: {
          country: patch.country,
          locationCountry: patch.locationCountry,
          locationCity: patch.locationCity,
          locationState: patch.locationState,
          locationRegion: patch.locationRegion,
        },
      });
      return true;
    },

    async updateLastSeenById(id: string, lastSeenAt: Date): Promise<void> {
      const row = await prisma.job.findUnique({
        where: { id },
        select: { source: true },
      });
      if (!row) return;
      await prisma.job.update({
        where: { id },
        data: {
          lastSeenAt,
          expiresAt: computeJobExpiresAt({ source: row.source, lastSeenAt }),
          isActive: true,
        } as Prisma.JobUpdateInput,
      });
    },

    /**
     * When re-ingesting an existing `sourceUrl`, backfill or correct `postedAt` from the ATS
     * (keeps the earlier date when both exist — publication proxy).
     */
    async mergePostedAtIfEarlier(id: string, candidate: Date | undefined): Promise<boolean> {
      if (!candidate || Number.isNaN(candidate.getTime())) return false;
      const row = await prisma.job.findUnique({
        where: { id },
        select: { postedAt: true },
      });
      if (!row) return false;
      const cur = row.postedAt;
      if (cur && candidate.getTime() >= cur.getTime()) return false;
      await prisma.job.update({
        where: { id },
        data: { postedAt: candidate },
      });
      return true;
    },

    async updateLastSeenBySourceUrl(sourceUrl: string, lastSeenAt: Date): Promise<void> {
      const row = await prisma.job.findUnique({
        where: { sourceUrl },
        select: { source: true },
      });
      if (!row) return;
      await prisma.job.update({
        where: { sourceUrl },
        data: {
          lastSeenAt,
          expiresAt: computeJobExpiresAt({ source: row.source, lastSeenAt }),
          isActive: true,
        } as Prisma.JobUpdateInput,
      });
    },

    async updateLastSeenBySourceUrls(
      sourceUrls: string[],
      lastSeenAt: Date,
    ): Promise<number> {
      if (sourceUrls.length === 0) return 0;
      const rows = await prisma.job.findMany({
        where: { sourceUrl: { in: sourceUrls } },
        select: { id: true, source: true },
      });
      if (rows.length === 0) return 0;

      const idsBySource = new Map<string, string[]>();
      for (const row of rows) {
        const existing = idsBySource.get(row.source);
        if (existing) existing.push(row.id);
        else idsBySource.set(row.source, [row.id]);
      }

      let touched = 0;
      for (const [source, ids] of idsBySource) {
        const result = await prisma.job.updateMany({
          where: { id: { in: ids } },
          data: {
            lastSeenAt,
            expiresAt: computeJobExpiresAt({ source, lastSeenAt }),
            isActive: true,
          } as Prisma.JobUpdateManyMutationInput,
        });
        touched += result.count;
      }
      return touched;
    },

    async ensureProcessingStatus(id: string, reason: string): Promise<boolean> {
      const rows = await prisma.$queryRaw<Array<{ previous_status: string | null }>>`
        WITH target AS (
          SELECT id, "status" AS previous_status
          FROM "Job"
          WHERE "id" = ${id}
            AND "status" IS NULL
        )
        UPDATE "Job" AS j
        SET "status" = ${JOB_STATUS_PROCESSING}
        FROM target
        WHERE j.id = target.id
        RETURNING target.previous_status
      `;
      if (rows.length > 0) {
        for (const row of rows) {
          recordStatusTransition(row.previous_status, JOB_STATUS_PROCESSING, reason);
        }
        logger.info(
          {
            event: "job_status_transition",
            jobId: id,
            from: null,
            to: JOB_STATUS_PROCESSING,
            reason,
          },
          "job_status_transition",
        );
        return true;
      }
      return false;
    },

    async promoteJobToReady(id: string, reason: string): Promise<boolean> {
      const rows = await prisma.$queryRaw<Array<{ previous_status: string | null }>>`
        WITH target AS (
          SELECT id, "status" AS previous_status
          FROM "Job"
          WHERE "id" = ${id}
            AND ("status" IN (${JOB_STATUS_PROCESSING}, ${JOB_STATUS_FAILED}) OR "status" IS NULL)
        )
        UPDATE "Job" AS j
        SET "status" = ${JOB_STATUS_READY}
        FROM target
        WHERE j.id = target.id
        RETURNING target.previous_status
      `;
      if (rows.length > 0) {
        for (const row of rows) {
          recordStatusTransition(row.previous_status, JOB_STATUS_READY, reason);
        }
        logger.info(
          {
            event: "job_status_transition",
            jobId: id,
            from: rows[0]?.previous_status ?? null,
            to: JOB_STATUS_READY,
            reason,
          },
          "job_status_transition",
        );
        return true;
      }
      return false;
    },

    async promoteJobToReadyIfParsedDescription(id: string, reason: string): Promise<boolean> {
      const rows = await prisma.$queryRaw<Array<{ previous_status: string | null }>>`
        WITH target AS (
          SELECT id, "status" AS previous_status
          FROM "Job"
          WHERE "id" = ${id}
            AND "parsedDescription" IS NOT NULL
            AND ("status" IN (${JOB_STATUS_PROCESSING}, ${JOB_STATUS_FAILED}) OR "status" IS NULL)
        )
        UPDATE "Job" AS j
        SET "status" = ${JOB_STATUS_READY}
        FROM target
        WHERE j.id = target.id
        RETURNING target.previous_status
      `;
      if (rows.length > 0) {
        for (const row of rows) {
          recordStatusTransition(row.previous_status, JOB_STATUS_READY, reason);
        }
        logger.info(
          {
            event: "job_status_transition",
            jobId: id,
            from: rows[0]?.previous_status ?? null,
            to: JOB_STATUS_READY,
            reason,
          },
          "job_status_transition",
        );
        return true;
      }
      return false;
    },

    async markJobFailedFromProcessing(id: string, reason: string): Promise<boolean> {
      const rows = await prisma.$queryRaw<Array<{ previous_status: string | null }>>`
        WITH target AS (
          SELECT id, "status" AS previous_status
          FROM "Job"
          WHERE "id" = ${id}
            AND "status" = ${JOB_STATUS_PROCESSING}
        )
        UPDATE "Job" AS j
        SET "status" = ${JOB_STATUS_FAILED}
        FROM target
        WHERE j.id = target.id
        RETURNING target.previous_status
      `;
      if (rows.length > 0) {
        for (const row of rows) {
          recordStatusTransition(row.previous_status, JOB_STATUS_FAILED, reason);
        }
        logger.info(
          {
            event: "job_status_transition",
            jobId: id,
            from: JOB_STATUS_PROCESSING,
            to: JOB_STATUS_FAILED,
            reason,
          },
          "job_status_transition",
        );
        return true;
      }
      return false;
    },

    async updateParsedDescription(
      id: string,
      parsed: Prisma.InputJsonValue,
    ): Promise<void> {
      const existing = await prisma.job.findUnique({
        where: { id },
        select: { parsedDescription: true, enriched: true, skills: true },
      });
      if (!existing) {
        logger.warn(
          { event: "updateParsedDescription_missing_job", id },
          "updateParsedDescription: job not found",
        );
        return;
      }

      const existingParsed = existing.parsedDescription;
      const newParsed = parsed;
      const existingScore = scoreParsedDescription(existingParsed);
      const newScore = scoreParsedDescription(newParsed);
      const existingSectionCount = countPopulatedSections(existingParsed);
      const newSectionCount = countPopulatedSections(newParsed);

      const shouldUpdateParsed = shouldReplaceParsedDescription(
        existingScore,
        newScore,
        existingSectionCount,
        newSectionCount,
      );

      const finalParsed = shouldUpdateParsed ? newParsed : existingParsed;

      const existingEnriched = jsonObjectOrEmpty(existing.enriched);
      const computedEnriched = enrichJob(finalParsed) as unknown as Record<string, unknown>;
      const mergedEnriched: Record<string, unknown> = {
        ...existingEnriched,
        ...computedEnriched,
      };
      const tech = computedEnriched.techStack;
      const techStack: string[] = Array.isArray(tech) ? tech.filter((x): x is string => typeof x === "string") : [];
      const mergedSkills = mergeJobSkillsList(existing.skills ?? [], techStack, maxMergedSkills());

      await prisma.job.update({
        where: { id },
        data: {
          parsedDescription: finalParsed as Prisma.InputJsonValue,
          enriched: mergedEnriched as Prisma.InputJsonValue,
          skills: mergedSkills,
        },
      });
      await this.promoteJobToReadyIfParsedDescription(id, "parsed_description_present");
    },
  };
}

export type JobRepository = ReturnType<typeof createJobRepository>;
