import type { Job } from "@prisma/client";
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

export function aggregateCanonicalFromSources(jobs: Job[]): {
  title: string;
  description: string | null;
  country: string;
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

  const country = mergeCountryCode(ordered);
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

  const salaryMins = ordered
    .map((j) => j.salaryMin)
    .filter((x): x is number => typeof x === "number" && x > 0);
  const salaryMin = salaryMins.length > 0 ? Math.max(...salaryMins) : null;

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
    salaryMin,
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
