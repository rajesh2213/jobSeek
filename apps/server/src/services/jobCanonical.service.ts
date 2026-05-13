import type { Job } from "@prisma/client";
import type { DedupJobInput } from "../modules/crawler/crawler.types.js";
import type { JobRepository } from "../modules/job/job.repository.js";
import {
  freshnessScore,
  getSourceQualityWeight,
} from "./jobRanking.service.js";
import { logger } from "../utils/logger.js";
import { isValidJobUrl } from "../utils/url.js";

/**
 * Prefer the title from the higher-quality ATS source; tie-break by longer title.
 */
export function selectBestTitle(
  currentTitle: string,
  currentSource: string,
  incomingTitle: string,
  incomingSource: string,
): string {
  const wIn = getSourceQualityWeight(incomingSource);
  const wCur = getSourceQualityWeight(currentSource);
  if (wIn > wCur) return incomingTitle;
  if (wIn < wCur) return currentTitle;
  return incomingTitle.length > currentTitle.length ? incomingTitle : currentTitle;
}

/**
 * Prefer the longest non-empty description (richer content).
 */
export function selectBestDescription(
  current: string | null | undefined,
  incoming: string | undefined,
): string | null {
  const a = (current ?? "").trim();
  const b = (incoming ?? "").trim();
  if (!a) return b || null;
  if (!b) return a;
  return b.length > a.length ? b : a;
}

export function mergeRemoteFlag(a: boolean, b: boolean): boolean {
  return a || b;
}

/** Union of taxonomy skill slugs across sources, sorted. */
export function mergeSkillsUnion(jobs: Pick<Job, "skills">[]): string[] {
  const s = new Set<string>();
  for (const j of jobs) {
    for (const x of j.skills ?? []) s.add(x);
  }
  return Array.from(s).sort();
}

/** Prefer ISO country from highest-quality source; ignore UNKNOWN when possible. */
export function mergeCountryCode(jobs: Job[]): string {
  const sorted = [...jobs].sort(
    (a, b) => getSourceQualityWeight(b.source) - getSourceQualityWeight(a.source),
  );
  for (const j of sorted) {
    if (j.country && j.country !== "UNKNOWN") return j.country;
  }
  return jobs[0]?.country ?? "UNKNOWN";
}

/**
 * Merge structured location from canonical + duplicate rows (source-quality order).
 * Prefer `locationCountry` over legacy `country` when resolving ISO code.
 */
export function mergeStructuredLocationFromSources(jobs: Job[]): {
  country: string;
  locationCountry: string;
  locationCity: string | null;
  locationState: string | null;
  locationRegion: string | null;
} {
  const sorted = [...jobs].sort(
    (a, b) => getSourceQualityWeight(b.source) - getSourceQualityWeight(a.source),
  );

  let locationCountry = "UNKNOWN";
  for (const j of sorted) {
    const lc = j.locationCountry?.trim();
    if (lc && lc !== "UNKNOWN") {
      locationCountry = j.locationCountry;
      break;
    }
  }
  if (locationCountry === "UNKNOWN") {
    for (const j of sorted) {
      const c = j.country?.trim();
      if (c && c !== "UNKNOWN") {
        locationCountry = c;
        break;
      }
    }
  }

  let country = "UNKNOWN";
  for (const j of sorted) {
    const c = j.country?.trim();
    if (c && c !== "UNKNOWN") {
      country = j.country;
      break;
    }
  }
  if (country === "UNKNOWN" && locationCountry !== "UNKNOWN") {
    country = locationCountry;
  }

  let locationCity: string | null = null;
  for (const j of sorted) {
    const v = j.locationCity?.trim();
    if (v) {
      locationCity = j.locationCity;
      break;
    }
  }

  let locationState: string | null = null;
  for (const j of sorted) {
    const v = j.locationState?.trim();
    if (v) {
      locationState = j.locationState;
      break;
    }
  }

  let locationRegion: string | null = null;
  for (const j of sorted) {
    const v = j.locationRegion?.trim();
    if (v) {
      locationRegion = j.locationRegion;
      break;
    }
  }

  return {
    country,
    locationCountry,
    locationCity,
    locationState,
    locationRegion,
  };
}

/** True when DB has no usable value (null, empty, whitespace, or UNKNOWN). */
export function isMissingLocation(value?: string | null): boolean {
  const t = value?.trim();
  return !t || t === "UNKNOWN";
}

/**
 * Compute DB patch when re-ingesting the same sourceUrl with richer location than stored.
 * Returns null if nothing to change.
 */
export function computeLocationPatchFromReingest(
  row: Pick<
    Job,
    "country" | "locationCountry" | "locationCity" | "locationState" | "locationRegion"
  >,
  incoming: Pick<
    DedupJobInput,
    "country" | "locationCountry" | "locationCity" | "locationState" | "locationRegion"
  >,
): {
  country: string;
  locationCountry: string;
  locationCity: string | null;
  locationState: string | null;
  locationRegion: string | null;
} | null {
  let locationCountry = row.locationCountry;
  let country = row.country;
  let locationCity = row.locationCity;
  let locationState = row.locationState;
  let locationRegion = row.locationRegion;

  if (!isMissingLocation(incoming.locationCountry) && isMissingLocation(locationCountry)) {
    locationCountry = incoming.locationCountry;
  }
  if (!isMissingLocation(incoming.country) && isMissingLocation(country)) {
    country = incoming.country;
  }
  if (locationCountry !== row.locationCountry && !isMissingLocation(locationCountry)) {
    if (isMissingLocation(country)) {
      country = !isMissingLocation(incoming.country) ? incoming.country : locationCountry;
    }
  }

  const incCity = incoming.locationCity?.trim();
  if (incCity && isMissingLocation(locationCity)) {
    locationCity = incoming.locationCity ?? null;
  }
  const incState = incoming.locationState?.trim();
  if (incState && isMissingLocation(locationState)) {
    locationState = incoming.locationState ?? null;
  }
  const incRegion = incoming.locationRegion?.trim();
  if (incRegion && isMissingLocation(locationRegion)) {
    locationRegion = incoming.locationRegion ?? null;
  }

  const changed =
    locationCountry !== row.locationCountry ||
    country !== row.country ||
    locationCity !== row.locationCity ||
    locationState !== row.locationState ||
    locationRegion !== row.locationRegion;

  if (!changed) return null;
  return { country, locationCountry, locationCity, locationState, locationRegion };
}

/** Prefer category from highest-quality source; ignore `other` when possible. */
export function mergeCategorySlug(jobs: Job[]): string {
  const sorted = [...jobs].sort(
    (a, b) => getSourceQualityWeight(b.source) - getSourceQualityWeight(a.source),
  );
  for (const j of sorted) {
    if (j.category && j.category !== "other") return j.category;
  }
  return jobs[0]?.category ?? "other";
}

/** Prefer apply URL from highest-quality source; fall back to valid listing URL. */
export function mergeApplyUrl(jobs: Job[]): string | null {
  const sorted = [...jobs].sort(
    (a, b) => getSourceQualityWeight(b.source) - getSourceQualityWeight(a.source),
  );
  for (const j of sorted) {
    const u = j.applyUrl?.trim();
    if (u && isValidJobUrl(u)) return u;
    if (j.sourceUrl && isValidJobUrl(j.sourceUrl)) return j.sourceUrl;
  }
  return null;
}

/**
 * Aggregate canonical fields from the canonical row + all duplicate source rows.
 */
function mergeExperienceLevelFromSources(jobs: Job[]): string | null {
  const sorted = [...jobs].sort(
    (a, b) => getSourceQualityWeight(b.source) - getSourceQualityWeight(a.source),
  );
  for (const j of sorted) {
    const e = j.experienceLevel?.trim();
    if (e) return e;
  }
  return null;
}

/**
 * Pick the best coherent salary tuple from a single source row.
 * Never mixes min from one row with max from another — that would
 * create synthetic ranges never published by any employer.
 *
 * Priority:
 * 1. Complete range (min+max) from jsonld source
 * 2. Complete range from any source
 * 3. Min-only from jsonld source
 * 4. Min-only from any source (highest min wins)
 */
export function pickBestSalary(
  rows: Array<{
    salaryMin: number | null;
    salaryMax: number | null;
    salarySource: string | null;
  }>,
): { salaryMin: number | null; salaryMax: number | null; salarySource: string | null } {
  const withSalary = rows.filter(
    (r) => typeof r.salaryMin === "number" && r.salaryMin > 0,
  );
  if (withSalary.length === 0) {
    return { salaryMin: null, salaryMax: null, salarySource: null };
  }

  const ranged = withSalary.filter(
    (r) => typeof r.salaryMax === "number" && r.salaryMax > 0,
  );
  const pool = ranged.length > 0 ? ranged : withSalary;

  const jsonld = pool.filter((r) => r.salarySource === "jsonld");
  const best = jsonld.length > 0 ? jsonld : pool;

  const winner = best.reduce((a, b) =>
    (b.salaryMin ?? 0) > (a.salaryMin ?? 0) ? b : a,
  );

  return {
    salaryMin: winner.salaryMin,
    salaryMax: winner.salaryMax,
    salarySource: winner.salarySource,
  };
}

export function aggregateCanonicalFromSources(jobs: Job[]): {
  title: string;
  description: string | null;
  country: string;
  locationCountry: string;
  locationCity: string | null;
  locationState: string | null;
  locationRegion: string | null;
  category: string;
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
} {
  if (jobs.length === 0) {
    throw new Error("aggregateCanonicalFromSources: empty job set");
  }

  const canonical = jobs.find((j) => j.canonicalJobId === null) ?? jobs[0];
  const ordered = jobs;

  let title = ordered[0].title;
  let titleSource = ordered[0].source;
  for (let i = 1; i < ordered.length; i++) {
    const j = ordered[i];
    const nt = selectBestTitle(title, titleSource, j.title, j.source);
    title = nt;
    if (nt === j.title) titleSource = j.source;
  }

  let role = ordered[0].role;
  let roleSource = ordered[0].source;
  for (let i = 1; i < ordered.length; i++) {
    const j = ordered[i];
    const nr = selectBestTitle(role, roleSource, j.role, j.source);
    role = nr;
    if (nr === j.role) roleSource = j.source;
  }

  let description: string | null = ordered[0].description ?? null;
  for (let i = 1; i < ordered.length; i++) {
    description = selectBestDescription(description, ordered[i].description ?? undefined);
  }

  const locMerged = mergeStructuredLocationFromSources(ordered);
  const country = locMerged.country;
  const category = mergeCategorySlug(ordered);
  const skills = mergeSkillsUnion(ordered);

  let isRemote = ordered[0].isRemote;
  for (let i = 1; i < ordered.length; i++) {
    isRemote = mergeRemoteFlag(isRemote, ordered[i].isRemote);
  }

  /** Earliest non-null date = best proxy for "when the role was published" across duplicate rows. */
  let postedAt: Date | null = ordered[0].postedAt ?? null;
  for (let i = 1; i < ordered.length; i++) {
    const t = ordered[i].postedAt;
    if (!t) continue;
    if (!postedAt || t.getTime() < postedAt.getTime()) postedAt = t;
  }

  const salaryTuple = pickBestSalary(ordered);

  const applyUrl = mergeApplyUrl(ordered);

  const displaySource = ordered.reduce((best, j) => {
    const wb = getSourceQualityWeight(best.source);
    const wj = getSourceQualityWeight(j.source);
    if (wj > wb) return j;
    if (wj < wb) return best;
    return (j.description?.length ?? 0) > (best.description?.length ?? 0) ? j : best;
  });
  const source = displaySource.source;

  const sourceWeight = Math.max(
    ...ordered.map((j) => j.sourceWeight ?? getSourceQualityWeight(j.source)),
  );

  const fr = freshnessScore(postedAt, canonical.createdAt);

  let workType: string;
  if (ordered.some((j) => j.workType === "hybrid")) workType = "hybrid";
  else if (isRemote) workType = "remote";
  else workType = "onsite";

  const experienceLevel = mergeExperienceLevelFromSources(ordered);

  return {
    title,
    description,
    country,
    locationCountry: locMerged.locationCountry,
    locationCity: locMerged.locationCity,
    locationState: locMerged.locationState,
    locationRegion: locMerged.locationRegion,
    category,
    isRemote,
    workType,
    experienceLevel,
    postedAt,
    applyUrl,
    freshnessScore: fr,
    sourceWeight,
    source,
    role,
    skills,
    salaryMin: salaryTuple.salaryMin,
    salaryMax: salaryTuple.salaryMax,
    salarySource: salaryTuple.salarySource,
  };
}

/**
 * Reload canonical + duplicates and persist aggregated best data + cached scores.
 */
export async function recomputeCanonical(
  repo: JobRepository,
  canonicalId: string,
): Promise<void> {
  const canonical = await repo.findByIdRaw(canonicalId);
  if (!canonical || canonical.canonicalJobId) return;

  const duplicates = await repo.findDuplicatesByCanonicalId(canonicalId);
  const all = [canonical, ...duplicates];
  const agg = aggregateCanonicalFromSources(all);

  await repo.updateCanonicalAggregation(canonicalId, agg);

  logger.info(
    {
      event: "job_canonical_recomputed",
      canonicalId,
      sourceCount: all.length,
    },
    "Canonical job recomputed from sources",
  );
}

/**
 * When comparing multiple job rows for the same fingerprint, pick the best representative by source quality.
 */
export function selectBestSourceJob<T extends { source: string }>(jobs: T[]): T {
  if (jobs.length === 0) {
    throw new Error("selectBestSourceJob: empty jobs");
  }
  return jobs.reduce((best, j) =>
    getSourceQualityWeight(j.source) > getSourceQualityWeight(best.source) ? j : best,
  );
}

export const selectBestSource = selectBestSourceJob;
