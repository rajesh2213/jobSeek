import { PrismaClient, Prisma } from "@prisma/client";
import type { Job } from "@prisma/client";

import { enrichJob } from "../enrichment/enrichment.service.js";
import type { DedupJobInput } from "../crawler/crawler.types.js";
import { computeStoredScores } from "../../services/jobRanking.service.js";
import { computeJobExpiresAt } from "../../services/jobRetentionPolicy.service.js";
import { isValidJobUrl } from "../../utils/url.js";
import { logger } from "../../utils/logger.js";
import {
  getJobListSlowThresholdMs,
  isJobListPerfDebugEnabled,
  logJobListPerf,
  logJobListSlow,
  nowPerfMs,
} from "../../utils/jobListPerf.js";
import { jobListRequestDiag } from "./jobListRequestContext.js";
import { expandLocationFilter, getRegions } from "../../utils/locationResolver.js";
import {
  computeLocationPatchFromReingest,
  computeSkillsPatchFromReingest,
  computeWorkModePatchFromReingest,
} from "../../services/jobCanonical.service.js";
import { deriveJobSkills } from "../../utils/jobSkills.js";
import { recordStatusTransition } from "../../services/jobStatusMetrics.service.js";
import { jobParsedNoopSkipEnabled } from "../../utils/jobWriteOptimization.js";
import {
  LISTING_EXCLUDED_ROLE_SLUGS,
  LIST_JOB_HYDRATE_DESCRIPTION_MAX_CHARS,
  ROLE_SUGGEST_EXTRA_EXCLUDED,
} from "./jobListing.constants.js";
import { computeJobQualityFlags } from "../../services/qualityFlags.service.js";
import {
  buildSitemapCursorWhereSql,
  decodeSitemapJobCursor,
  encodeSitemapJobCursor,
  type SitemapJobCursor,
  type SitemapJobRow,
} from "./sitemapCursor.js";

export type JobStatus = "processing" | "ready" | "failed";

const JOB_STATUS_PROCESSING: JobStatus = "processing";
const JOB_STATUS_READY: JobStatus = "ready";
const JOB_STATUS_FAILED: JobStatus = "failed";

/**
 * Single derived value for `Job.effectivePostedAt` (matches SQL COALESCE(postedAt, createdAt)).
 * Never use wall-clock `now` here — only publication proxy or row ingest time.
 */
function deriveEffectivePostedAt(postedAt: Date | null, createdAt: Date): Date {
  return postedAt ?? createdAt;
}

function safeApplyUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return isValidJobUrl(url) ? url : null;
}

function jobQualityData(input: {
  source: string;
  sourceUrl: string;
  description: string | null | undefined;
  parsedDescription?: unknown;
}): Pick<
  Prisma.JobUncheckedCreateInput,
  | "hasNonemptyDescription"
  | "hasUsableParsed"
  | "hasValidWorkdayUrlShape"
  | "isPublishable"
  | "requiresRepair"
> {
  const flags = computeJobQualityFlags({
    source: input.source,
    sourceUrl: input.sourceUrl,
    description: input.description,
    parsedDescription: input.parsedDescription ?? null,
  });
  return {
    hasNonemptyDescription: flags.hasNonemptyDescription,
    hasUsableParsed: flags.hasUsableParsed,
    hasValidWorkdayUrlShape: flags.hasValidWorkdayUrlShape,
    isPublishable: flags.isPublishable,
    requiresRepair: flags.requiresRepair,
  };
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

function publicVisibilityGuardEnabled(): boolean {
  return process.env.PUBLIC_JOB_VISIBILITY_GUARD_ENABLED !== "0";
}

/**
 * Public-only quality gate to hide known-bad listings while preserving raw DB rows for repair.
 * Keeps ingestion/canonicalization untouched and is reversible via env flag.
 */
function discoveryVisibilityQualityWhere(): Prisma.JobWhereInput {
  return { isPublishable: true };
}

/** SQL equivalent of {@link discoveryVisibilityQualityWhere}. Uses indexed `isPublishable`. */
function discoveryVisibilityQualitySql(): Prisma.Sql {
  return Prisma.sql`j."isPublishable" = true`;
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
    { isActive: true },
    {
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    { role: { notIn: [...LISTING_EXCLUDED_ROLE_SLUGS] } },
  ];
  const statusFilter = readyStatusWhere(includeProcessing);
  if (statusFilter) and.push(statusFilter);
  if (publicVisibilityGuardEnabled()) {
    and.push(discoveryVisibilityQualityWhere());
  }

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
    Prisma.sql`j."isActive" = true`,
    Prisma.sql`(j."expiresAt" IS NULL OR j."expiresAt" > NOW())`,
    Prisma.sql`j.role NOT IN (${excluded})`,
  ];
  const statusFilter = readyStatusSql(includeProcessing);
  if (statusFilter) parts.push(statusFilter);
  if (publicVisibilityGuardEnabled()) {
    parts.push(discoveryVisibilityQualitySql());
  }

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
      Prisma.sql`((j."postedAt" IS NOT NULL AND j."postedAt" >= ${since}) OR (j."postedAt" IS NULL AND j."createdAt" >= ${since}))`,
    );
  }
  if (filters.postedAfter !== undefined) {
    const since = filters.postedAfter;
    parts.push(
      Prisma.sql`((j."postedAt" IS NOT NULL AND j."postedAt" > ${since}) OR (j."postedAt" IS NULL AND j."createdAt" > ${since}))`,
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

/**
 * Exact `SELECT j.id …` used by {@link createJobRepository}'s `findManyCanonicalFiltered`.
 * For developer scripts only (manual EXPLAIN); keeps parity with production query shape.
 */
export function sqlForCanonicalListingIds(input: {
  filters?: JobDiscoveryFilters;
  sort: "latest" | "salary_desc";
  limit: number;
  offset: number;
  includeProcessing?: boolean;
}): Prisma.Sql {
  const whereSql = buildDiscoveryWhereSql(input.filters, {
    includeProcessing: input.includeProcessing ?? false,
  });
  if (input.sort === "latest") {
    /*
     * Company hub: sort by unified recency (listingFreshnessAt) so a job
     * discovered yesterday ranks above a stale postedAt from two weeks ago.
     * Global discovery keeps POSTED-before-DISCOVERED ordering for the main feed.
     */
    if (input.filters?.companyId) {
      return Prisma.sql`
        SELECT j.id FROM "Job" j
        WHERE ${whereSql}
        ORDER BY j."listingFreshnessAt" DESC,
                 j."postedAt" DESC NULLS LAST,
                 j."createdAt" DESC,
                 j.id ASC
        LIMIT ${input.limit} OFFSET ${input.offset}
      `;
    }
    /*
     * Freshness-source-aware ordering (Phase 5 of the freshness-integrity overhaul):
     *
     *   1. j."postedAt" DESC NULLS LAST
     *      - Puts rows with a true ATS-supplied publish date ("POSTED" bucket)
     *        ahead of rows where postedAt is NULL ("DISCOVERED" bucket).
     *      - Within the POSTED bucket this also orders by the real publish date.
     *
     *   2. j."listingFreshnessAt" DESC
     *      - Tiebreaker for DISCOVERED rows (postedAt all NULL → tie on key 1).
     *        listingFreshnessAt = COALESCE(postedAt, createdAt) so for DISCOVERED
     *        this is effectively createdAt DESC.
     *
     *   3. j."createdAt" DESC, j.id ASC
     *      - Strict deterministic tiebreaker so cursor pagination is stable across
     *        requests even when listingFreshnessAt collides (common for batches).
     *
     * Index usage:
     *   - Served by migration 20260512170000_job_canonical_latest_partial_index
     *     (idx_jobs_canonical_latest_v2), a partial composite indexed exactly
     *     on (postedAt DESC NULLS LAST, listingFreshnessAt DESC, createdAt DESC,
     *     id) with the same predicate as the WHERE clause. Production EXPLAIN
     *     resolves to an Index Only Scan with no Sort node (~0.235 ms on 95k
     *     candidates) — see docs/freshness-overhaul/05-query-perf.md.
     */
    return Prisma.sql`
      SELECT j.id FROM "Job" j
      WHERE ${whereSql}
      ORDER BY j."postedAt" DESC NULLS LAST,
               j."listingFreshnessAt" DESC,
               j."createdAt" DESC,
               j.id ASC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `;
  }
  return Prisma.sql`
    SELECT j.id FROM "Job" j
    WHERE ${whereSql}
    ORDER BY j."salaryMin" DESC NULLS LAST, j."createdAt" DESC, j.id ASC
    LIMIT ${input.limit} OFFSET ${input.offset}
  `;
}

/**
 * Slim keyset query for SEO sitemap generation — same discovery WHERE + ORDER BY as
 * `sqlForCanonicalListingIds` (latest sort), no OFFSET, no hydrate.
 */
export function sqlForCanonicalSitemapRows(input: {
  limit: number;
  cursor?: SitemapJobCursor | null;
  filters?: JobDiscoveryFilters;
  includeProcessing?: boolean;
}): Prisma.Sql {
  const whereSql = buildDiscoveryWhereSql(input.filters, {
    includeProcessing: input.includeProcessing ?? false,
  });
  const cursor = input.cursor ?? null;
  const cursorSql =
    cursor === null ? Prisma.sql`TRUE` : buildSitemapCursorWhereSql(cursor);

  return Prisma.sql`
    SELECT
      j.id,
      j."postedAt",
      j."createdAt",
      j."listingFreshnessAt"
    FROM "Job" j
    WHERE ${whereSql}
      AND (${cursorSql})
    ORDER BY j."postedAt" DESC NULLS LAST,
             j."listingFreshnessAt" DESC,
             j."createdAt" DESC,
             j.id ASC
    LIMIT ${input.limit}
  `;
}

function reorderJobsByCanonicalIds<T extends { id: string }>(jobs: T[], ids: string[]): void {
  const order = new Map(ids.map((id, i) => [id, i]));
  jobs.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

function jobListHttpCorrelationFields(): Record<string, unknown> {
  const ctx = jobListRequestDiag.getStore();
  if (!ctx) return {};
  return {
    jobListHttpSort: ctx.sort,
    jobListHttpPage: ctx.page,
    jobListHttpLimit: ctx.limit,
    jobListHttpMeteredLimit: ctx.meteredLimit,
    jobListHttpFilterSummary: ctx.filterSummary,
  };
}

function getCompanyListingSelect(includeCompanyJobCount: boolean) {
  if (includeCompanyJobCount) {
    return {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      domain: true,
      careersUrl: true,
      _count: { select: { jobs: true } },
    } as const;
  }
  return {
    id: true,
    name: true,
    slug: true,
    logoUrl: true,
    domain: true,
  } as const;
}

/**
 * Prisma select for shadow/full listing experiments (not used on hot GET /jobs path).
 */
export function buildCanonicalListingJobSelect(includeCompanyJobCount: boolean) {
  const companyInner = getCompanyListingSelect(includeCompanyJobCount);
  return {
    id: true,
    title: true,
    companyId: true,
    country: true,
    locationCity: true,
    locationState: true,
    locationCountry: true,
    locationRegion: true,
    category: true,
    isRemote: true,
    workType: true,
    experienceLevel: true,
    description: true,
    parsedDescription: true,
    source: true,
    sourceUrl: true,
    applyUrl: true,
    postedAt: true,
    effectivePostedAt: true,
    createdAt: true,
    updatedAt: true,
    lastSeenAt: true,
    expiresAt: true,
    isActive: true,
    salaryMin: true,
    role: true,
    skills: true,
    status: true,
    company: { select: companyInner },
  } as const;
}

/** Slim row shape for production listing hydrate (single JOIN query). */
type ListingJobJoinRow = {
  id: string;
  title: string;
  role: string;
  companyId: string;
  country: string;
  locationCountry: string;
  isRemote: boolean;
  workType: string;
  description: string | null;
  parsedDescription: unknown;
  sourceUrl: string;
  applyUrl: string | null;
  postedAt: Date | null;
  effectivePostedAt: Date | null;
  createdAt: Date;
  salaryMin: number | null;
  skills: string[];
  status: string | null;
  co_id: string;
  co_name: string;
  co_slug: string;
  co_logoUrl: string | null;
  co_domain: string | null;
};

/**
 * Production listing hydrate: one round-trip (job + company JOIN), bounded description I/O.
 */
async function hydrateCanonicalListingByIds(
  prisma: PrismaClient,
  ids: string[],
  options?: { includeCompanyJobCount?: boolean; truncChars?: number },
): Promise<JobWithCompany[]> {
  if (ids.length === 0) return [];
  const truncChars = options?.truncChars ?? LIST_JOB_HYDRATE_DESCRIPTION_MAX_CHARS;
  const safeLen = Math.max(256, Math.min(500_000, Math.floor(truncChars)));
  void options?.includeCompanyJobCount;

  const rows = await prisma.$queryRaw<ListingJobJoinRow[]>`
    SELECT
      j.id,
      j.title,
      j.role,
      j."companyId",
      j.country,
      j."locationCountry",
      j."isRemote",
      j."workType",
      CASE
        WHEN j."parsedDescription" IS NOT NULL THEN NULL::text
        ELSE SUBSTRING(j.description FROM 1 FOR (${safeLen})::integer)
      END AS description,
      j."parsedDescription",
      j."sourceUrl",
      j."applyUrl",
      j."postedAt",
      j."effectivePostedAt",
      j."createdAt",
      j."salaryMin",
      j.skills,
      j.status,
      c.id AS "co_id",
      c.name AS "co_name",
      c.slug AS "co_slug",
      c."logoUrl" AS "co_logoUrl",
      c.domain AS "co_domain"
    FROM "Job" j
    INNER JOIN "Company" c ON c.id = j."companyId"
    WHERE j.id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}`))})
  `;

  const jobs: JobWithCompany[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    role: r.role,
    companyId: r.companyId,
    country: r.country,
    locationCountry: r.locationCountry,
    isRemote: r.isRemote,
    workType: r.workType,
    description: r.description,
    parsedDescription: r.parsedDescription,
    sourceUrl: r.sourceUrl,
    applyUrl: r.applyUrl,
    postedAt: r.postedAt,
    effectivePostedAt: r.effectivePostedAt,
    createdAt: r.createdAt,
    salaryMin: r.salaryMin,
    skills: r.skills,
    status: r.status,
    company: {
      id: r.co_id,
      name: r.co_name,
      slug: r.co_slug,
      logoUrl: r.co_logoUrl,
      domain: r.co_domain,
    },
  })) as unknown as JobWithCompany[];
  reorderJobsByCanonicalIds(jobs, ids);
  return jobs;
}

/** Row shape returned by {@link createJobRepository}'s trunc-description shadow hydrate SQL. */
type ListingJobRawRow = {
  id: string;
  title: string;
  companyId: string;
  country: string;
  locationCity: string | null;
  locationState: string | null;
  locationCountry: string;
  locationRegion: string | null;
  category: string;
  isRemote: boolean;
  workType: string;
  experienceLevel: string | null;
  description: string | null;
  source: string;
  sourceUrl: string;
  applyUrl: string | null;
  postedAt: Date | null;
  effectivePostedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date;
  expiresAt: Date | null;
  isActive: boolean;
  salaryMin: number | null;
  role: string;
  skills: string[];
  status: string | null;
};

export function createJobRepository(prisma: PrismaClient) {
  function buildBaseJobData(input: DedupJobInput) {
    const now = new Date();
    const createdAt = now;
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
      ...jobQualityData({
        source: input.source,
        sourceUrl: input.sourceUrl,
        description: input.description ?? null,
      }),
      applyUrl: safeApplyUrl(input.applyUrl),
      postedAt: input.postedAt ?? null,
      effectivePostedAt: deriveEffectivePostedAt(input.postedAt ?? null, createdAt),
      createdAt,
      lastSeenAt: now,
      expiresAt,
      isActive: true,
      freshnessScore: scores.freshnessScore,
      sourceWeight: scores.sourceWeight,
      atsJobId: input.atsJobId ?? null,
      role: input.role,
      skills: input.skills,
      salaryMin: input.salaryMin,
      salaryMax: input.salaryMax,
      salarySource: input.salarySource,
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
      const countQuery = Prisma.sql`
        SELECT COUNT(*)::bigint AS c FROM "Job" j WHERE ${whereSql}
      `;
      const rows = await prisma.$queryRaw<{ c: bigint }[]>(countQuery);
      return Number(rows[0]?.c ?? 0);
    },

    /**
     * Keyset-paginated canonical jobs for sitemap — discovery filters only, slim columns.
     */
    async findManyCanonicalForSitemap(input: {
      limit: number;
      cursor?: string | null;
      filters?: JobDiscoveryFilters;
      includeProcessing?: boolean;
    }): Promise<{ rows: SitemapJobRow[]; nextCursor: string | null }> {
      const limit = Math.max(1, Math.min(1000, Math.floor(input.limit)));
      let decodedCursor: SitemapJobCursor | null = null;
      if (input.cursor) {
        decodedCursor = decodeSitemapJobCursor(input.cursor);
      }
      const query = sqlForCanonicalSitemapRows({
        limit,
        cursor: decodedCursor,
        filters: input.filters,
        includeProcessing: input.includeProcessing,
      });
      const rows = await prisma.$queryRaw<SitemapJobRow[]>(query);
      const last = rows.length > 0 ? rows[rows.length - 1] : null;
      const nextCursor =
        rows.length === limit && last
          ? encodeSitemapJobCursor({
              postedAt: last.postedAt,
              listingFreshnessAt: last.listingFreshnessAt,
              createdAt: last.createdAt,
              id: last.id,
            })
          : null;
      return { rows, nextCursor };
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
     *
     * Latest sort (post-overhaul, see `sqlForCanonicalListingIds`):
     *   ORDER BY postedAt DESC NULLS LAST,    -- POSTED bucket above DISCOVERED
     *            listingFreshnessAt DESC,      -- secondary key (stable for both buckets)
     *            createdAt DESC, id ASC        -- pagination-stable tiebreaker
     *
     * Real ATS publish dates always rank above discovery-only rows. Within
     * DISCOVERED rows ordering is unchanged (listingFreshnessAt == createdAt
     * when postedAt is NULL). Within POSTED rows ordering is unchanged
     * (listingFreshnessAt == postedAt when postedAt is set).
     *
     * Salary sort: salaryMin DESC NULLS LAST, createdAt DESC, id ASC.
     */
    async findManyCanonicalFiltered(options: {
      filters?: JobDiscoveryFilters;
      limit: number;
      offset: number;
      sort?: "latest" | "salary_desc";
      includeProcessing?: boolean;
    }): Promise<JobWithCompany[]> {
      const sort = options.sort ?? "latest";
      const perfDebug = isJobListPerfDebugEnabled();
      const slowThreshold = getJobListSlowThresholdMs();
      const trackPerf = perfDebug || slowThreshold > 0;
      const tFunc0 = trackPerf ? nowPerfMs() : 0;

      const idQuery = sqlForCanonicalListingIds({
        filters: options.filters,
        sort,
        limit: options.limit,
        offset: options.offset,
        includeProcessing: options.includeProcessing,
      });

      const tBeforeIds = trackPerf ? nowPerfMs() : 0;
      const idRows = await prisma.$queryRaw<{ id: string }[]>(idQuery);
      const tAfterIds = trackPerf ? nowPerfMs() : 0;

      const ids = idRows.map((r) => r.id);
      if (ids.length === 0) {
        if (trackPerf) {
          const queryIdsMs = tAfterIds - tBeforeIds;
          const totalMs = Math.round((nowPerfMs() - tFunc0) * 100) / 100;
          if (perfDebug) {
            logJobListPerf("JOB_LIST_QUERY_IDS", {
              durationMs: Math.round(queryIdsMs * 100) / 100,
              idRowCount: 0,
              limit: options.limit,
              offset: options.offset,
              sort,
            });
            logJobListPerf("JOB_LIST_HYDRATE", { durationMs: 0, rowCount: 0 });
            logJobListPerf("JOB_LIST_REORDER", { durationMs: 0 });
            logJobListPerf("JOB_LIST_TOTAL", {
              durationMs: totalMs,
              queryIdsMs: Math.round(queryIdsMs * 100) / 100,
              hydrateMs: 0,
              reorderMs: 0,
              approxHydratedBytes: 0,
              rowCount: 0,
              limit: options.limit,
              offset: options.offset,
              sort,
            });
          }
          if (slowThreshold > 0 && totalMs >= slowThreshold) {
            logJobListSlow({
              queryIdsMs: Math.round(queryIdsMs * 100) / 100,
              hydrateMs: 0,
              reorderMs: 0,
              approxHydratedBytes: 0,
              rowCount: 0,
              limit: options.limit,
              offset: options.offset,
              sort,
              totalMs,
              ...jobListHttpCorrelationFields(),
            });
          }
        }
        return [];
      }

      const tBeforeHydrate = trackPerf ? nowPerfMs() : 0;
      const jobs = await hydrateCanonicalListingByIds(prisma, ids, {
        includeCompanyJobCount: false,
      });
      const tAfterHydrate = trackPerf ? nowPerfMs() : 0;

      const tBeforeReorder = trackPerf ? nowPerfMs() : 0;
      reorderJobsByCanonicalIds(jobs, ids);
      const tAfterReorder = trackPerf ? nowPerfMs() : 0;

      if (trackPerf) {
        const queryIdsMs = tAfterIds - tBeforeIds;
        const hydrateMs = tAfterHydrate - tBeforeHydrate;
        const reorderMs = tAfterReorder - tBeforeReorder;
        const approxHydratedBytes = Buffer.byteLength(JSON.stringify(jobs), "utf8");
        const totalMs = Math.round((tAfterReorder - tFunc0) * 100) / 100;
        if (perfDebug) {
          logJobListPerf("JOB_LIST_QUERY_IDS", {
            durationMs: Math.round(queryIdsMs * 100) / 100,
            idRowCount: idRows.length,
            limit: options.limit,
            offset: options.offset,
            sort,
          });
          logJobListPerf("JOB_LIST_HYDRATE", {
            durationMs: Math.round(hydrateMs * 100) / 100,
            rowCount: jobs.length,
          });
          logJobListPerf("JOB_LIST_REORDER", {
            durationMs: Math.round(reorderMs * 100) / 100,
          });
          logJobListPerf("JOB_LIST_TOTAL", {
            durationMs: totalMs,
            queryIdsMs: Math.round(queryIdsMs * 100) / 100,
            hydrateMs: Math.round(hydrateMs * 100) / 100,
            reorderMs: Math.round(reorderMs * 100) / 100,
            approxHydratedBytes,
            rowCount: jobs.length,
            limit: options.limit,
            offset: options.offset,
            sort,
          });
        }
        if (slowThreshold > 0 && totalMs >= slowThreshold) {
          logJobListSlow({
            queryIdsMs: Math.round(queryIdsMs * 100) / 100,
            hydrateMs: Math.round(hydrateMs * 100) / 100,
            reorderMs: Math.round(reorderMs * 100) / 100,
            approxHydratedBytes,
            rowCount: jobs.length,
            limit: options.limit,
            offset: options.offset,
            sort,
            totalMs,
            ...jobListHttpCorrelationFields(),
          });
        }
      }

      return jobs as unknown as JobWithCompany[];
    },

    /**
     * Shadow / internal only: hydrate listing rows for id list (same shape as production listing).
     */
    async hydrateCanonicalListingForShadow(
      ids: string[],
      includeCompanyJobCount: boolean,
    ): Promise<JobWithCompany[]> {
      if (ids.length === 0) return [];
      const listSelect = buildCanonicalListingJobSelect(includeCompanyJobCount);
      const jobs = await prisma.job.findMany({
        where: { id: { in: ids } },
        select: listSelect,
      });
      reorderJobsByCanonicalIds(jobs, ids);
      return jobs as unknown as JobWithCompany[];
    },

    /**
     * Shadow / internal only: listing hydrate with `LEFT(description, truncChars)` in SQL, then company row + optional `_count`.
     * Does not change public API; used to measure description I/O cost and JSON parity vs full description.
     */
    async hydrateCanonicalListingTruncDescriptionForShadow(
      ids: string[],
      truncChars: number,
      includeCompanyJobCount: boolean,
    ): Promise<JobWithCompany[]> {
      if (ids.length === 0) return [];
      const safeLen = Math.max(256, Math.min(500_000, Math.floor(truncChars)));
      const rows = await prisma.$queryRaw<ListingJobRawRow[]>`
        SELECT
          j.id,
          j.title,
          j."companyId",
          j.country,
          j."locationCity",
          j."locationState",
          j."locationCountry",
          j."locationRegion",
          j.category,
          j."isRemote",
          j."workType",
          j."experienceLevel",
          SUBSTRING(j.description FROM 1 FOR (${safeLen})::integer) AS description,
          j.source,
          j."sourceUrl",
          j."applyUrl",
          j."postedAt",
          j."effectivePostedAt",
          j."createdAt",
          j."updatedAt",
          j."lastSeenAt",
          j."expiresAt",
          j."isActive",
          j."salaryMin",
          j.role,
          j.skills,
          j.status
        FROM "Job" j
        WHERE j.id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}`))})
      `;
      const companyIds = [...new Set(rows.map((r) => r.companyId))];
      const companySelect = getCompanyListingSelect(includeCompanyJobCount);
      const companies = await prisma.company.findMany({
        where: { id: { in: companyIds } },
        select: companySelect,
      });
      const cmap = new Map(companies.map((c) => [c.id, c]));
      const jobs = rows.map((r) => {
        const co = cmap.get(r.companyId);
        if (!co) {
          throw new Error(
            `hydrateCanonicalListingTruncDescriptionForShadow: missing company ${r.companyId}`,
          );
        }
        return { ...r, company: co };
      });
      reorderJobsByCanonicalIds(jobs, ids);
      return jobs as unknown as JobWithCompany[];
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
      const job = await prisma.job.upsert({
        where: { sourceUrl: input.sourceUrl },
        update: {
          updatedAt: seenAt,
          lastSeenAt: seenAt,
          expiresAt: computeJobExpiresAt({
            source: input.source,
            lastSeenAt: seenAt,
          }),
          isActive: true,
          ...jobQualityData({
            source: input.source,
            sourceUrl: input.sourceUrl,
            description: input.description ?? null,
          }),
        } as Prisma.JobUpdateInput,
        create: {
          ...buildBaseJobData(input),
          fingerprintVersion: "v2",
        },
      });
      const derived = deriveEffectivePostedAt(job.postedAt, job.createdAt);
      const cur = job.effectivePostedAt;
      if (cur === null || cur.getTime() !== derived.getTime()) {
        return prisma.job.update({
          where: { id: job.id },
          data: { effectivePostedAt: derived },
        });
      }
      return job;
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
      const row = await prisma.job.findUnique({
        where: { id },
        select: {
          createdAt: true,
          source: true,
          sourceUrl: true,
          parsedDescription: true,
        },
      });
      if (!row) return;
      await prisma.job.update({
        where: { id },
        data: {
          title: data.title,
          description: data.description,
          country: data.country ?? "UNKNOWN",
          category: data.category ?? "other",
          isRemote: data.isRemote,
          postedAt: data.postedAt,
          effectivePostedAt: deriveEffectivePostedAt(data.postedAt, row.createdAt),
          ...jobQualityData({
            source: row.source,
            sourceUrl: row.sourceUrl,
            description: data.description,
            parsedDescription: row.parsedDescription,
          }),
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
        salaryMax: number | null;
        salarySource: string | null;
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
          salaryMax: data.salaryMax,
          salarySource: data.salarySource,
          effectivePostedAt: deriveEffectivePostedAt(data.postedAt, row.createdAt),
          ...jobQualityData({
            source: data.source,
            sourceUrl: row.sourceUrl,
            description: data.description,
            parsedDescription: row.parsedDescription,
          }),
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

    /**
     * Promote `isRemote` / `workType` when re-ingest parser output is richer (never demotes remote).
     */
    async mergeSkillsFromReingest(
      id: string,
      incoming: Pick<
        DedupJobInput,
        "title" | "description" | "isRemote" | "category" | "locationCity"
      >,
    ): Promise<boolean> {
      const row = await prisma.job.findUnique({
        where: { id },
        select: {
          title: true,
          description: true,
          isRemote: true,
          locationCity: true,
          category: true,
          skills: true,
        },
      });
      if (!row) return false;
      const patch = computeSkillsPatchFromReingest(row, incoming);
      logger.info(
        {
          event: "skills_merge",
          jobId: id,
          applied: patch !== null,
          beforeCount: row.skills?.length ?? 0,
          afterCount: patch?.length ?? row.skills?.length ?? 0,
        },
        "skills_merge",
      );
      if (!patch) return false;
      await prisma.job.update({
        where: { id },
        data: { skills: patch },
      });
      return true;
    },

    async mergeWorkModeFromReingest(
      id: string,
      incoming: Pick<DedupJobInput, "isRemote" | "workType">,
    ): Promise<boolean> {
      const row = await prisma.job.findUnique({ where: { id } });
      if (!row) return false;
      const patch = computeWorkModePatchFromReingest(row, incoming);
      logger.info(
        {
          event: "work_mode_merge",
          jobId: id,
          existing: { isRemote: row.isRemote, workType: row.workType },
          incoming: { isRemote: incoming.isRemote, workType: incoming.workType },
          applied: patch !== null,
        },
        "work_mode_merge",
      );
      if (!patch) return false;
      await prisma.job.update({
        where: { id },
        data: {
          isRemote: patch.isRemote,
          workType: patch.workType,
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
        select: { postedAt: true, createdAt: true },
      });
      if (!row) return false;
      const cur = row.postedAt;
      if (cur && candidate.getTime() >= cur.getTime()) return false;
      await prisma.job.update({
        where: { id },
        data: {
          postedAt: candidate,
          effectivePostedAt: deriveEffectivePostedAt(candidate, row.createdAt),
        },
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
        select: {
          parsedDescription: true,
          enriched: true,
          skills: true,
          source: true,
          sourceUrl: true,
          title: true,
          description: true,
          isRemote: true,
          locationCity: true,
          category: true,
          workType: true,
        },
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
      const techStack: string[] = Array.isArray(tech)
        ? tech.filter((x): x is string => typeof x === "string")
        : [];
      const mergedSkills = deriveJobSkills({
        title: existing.title,
        description: existing.description ?? undefined,
        location: existing.locationCity ?? undefined,
        isRemote: existing.isRemote,
        category: existing.category,
        enrichmentTechStack: techStack,
      });

      if (jobParsedNoopSkipEnabled() && !shouldUpdateParsed) {
        const sameParsed =
          JSON.stringify(existingParsed) === JSON.stringify(finalParsed);
        const sameEnriched =
          JSON.stringify(mergedEnriched) === JSON.stringify(existingEnriched);
        const prevSkills = existing.skills ?? [];
        const skillsUnchanged =
          prevSkills.length === mergedSkills.length &&
          [...prevSkills].map((s) => s.trim().toLowerCase()).sort().join("\0") ===
            [...mergedSkills].map((s) => s.trim().toLowerCase()).sort().join("\0");
        if (sameParsed && sameEnriched && skillsUnchanged) {
          await this.promoteJobToReadyIfParsedDescription(id, "parsed_description_present");
          return;
        }
      }

      const enrichedRemoteType =
        typeof mergedEnriched.remoteType === "string" ? mergedEnriched.remoteType : null;
      const shouldPromoteHybrid =
        enrichedRemoteType === "hybrid" && existing.workType !== "hybrid";

      await prisma.job.update({
        where: { id },
        data: {
          parsedDescription: finalParsed as Prisma.InputJsonValue,
          enriched: mergedEnriched as Prisma.InputJsonValue,
          skills: mergedSkills,
          ...(shouldPromoteHybrid ? { workType: "hybrid" } : {}),
          ...jobQualityData({
            source: existing.source,
            sourceUrl: existing.sourceUrl,
            description: existing.description,
            parsedDescription: finalParsed,
          }),
        },
      });
      await this.promoteJobToReadyIfParsedDescription(id, "parsed_description_present");
    },
  };
}

export type JobRepository = ReturnType<typeof createJobRepository>;
