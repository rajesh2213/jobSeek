import type { Job } from "@prisma/client";

/** DB hybrid ordering weight (see job.repository findManyCanonicalRanked). */
export const HYBRID_DB_FRESHNESS_WEIGHT = 0.5;
export const HYBRID_DB_SOURCE_WEIGHT = 0.3;

/** Tunable weights for ranking (sum does not need to be 1). */
export interface JobRankingWeights {
  freshness: number;
  sourceQuality: number;
  titleRelevance: number;
}

export const DEFAULT_RANKING_WEIGHTS: JobRankingWeights = {
  freshness: 0.35,
  sourceQuality: 0.25,
  titleRelevance: 0.4,
};

/** Decay constant: higher = older jobs drop faster. */
export const DEFAULT_FRESHNESS_LAMBDA = 0.08;

export interface JobRankingFilters {
  /** Space-separated or comma-separated query e.g. "nodejs remote india" */
  query?: string;
}

export interface RankedJob<J extends Job = Job> {
  job: J;
  score: number;
  freshnessScore: number;
  sourceQualityScore: number;
  titleRelevanceScore: number;
}

const SOURCE_WEIGHTS: Record<string, number> = {
  greenhouse: 1.0,
  lever: 0.95,
  ashby: 0.95,
  workday: 0.85,
  remoteok: 0.65,
  wellfound: 0.72,
  careers_page: 0.55,
  /**
   * Remote Rocketship / OpenClaw feed: optional third-party acceleration, not a primary ATS board.
   * Slightly above `careers_page` (structured remote listings) but below direct ATS (`remoteok`).
   * Canonical title/description merge still prefers higher-weight sources when duplicates exist.
   */
  openclaw: 0.62,
};

/**
 * Static ATS source quality (normalized source name, lowercase).
 */
export function getSourceQualityWeight(source: string): number {
  const key = source.trim().toLowerCase();
  return SOURCE_WEIGHTS[key] ?? 0.7;
}

/**
 * Composite score used for DB ordering (matches SQL in repository).
 */
export function hybridDbRankingScore(job: Job): number {
  const f =
    typeof job.freshnessScore === "number" ? job.freshnessScore : freshnessScore(job.postedAt, job.createdAt);
  const s =
    typeof job.sourceWeight === "number" ? job.sourceWeight : getSourceQualityWeight(job.source);
  return f * HYBRID_DB_FRESHNESS_WEIGHT + s * HYBRID_DB_SOURCE_WEIGHT;
}

/**
 * Persisted on ingest / recompute for scalable listing.
 * `createdAt` at ingest should match the row’s DB first-seen time (typically `now` on insert);
 * freshness decay uses COALESCE(postedAt, createdAt) via `freshnessScore` / `ageInDays`.
 */
export function computeStoredScores(
  source: string,
  postedAt: Date | null | undefined,
  createdAt: Date,
  lambda: number = DEFAULT_FRESHNESS_LAMBDA,
): { freshnessScore: number; sourceWeight: number } {
  return {
    freshnessScore: freshnessScore(postedAt ?? null, createdAt, lambda),
    sourceWeight: getSourceQualityWeight(source),
  };
}

function freshnessForRanking(job: Job, lambda: number): number {
  if (typeof job.freshnessScore === "number") {
    return job.freshnessScore;
  }
  return freshnessScore(job.postedAt, job.createdAt, lambda);
}

function sourceForRanking(job: Job): number {
  if (typeof job.sourceWeight === "number") {
    return job.sourceWeight;
  }
  return getSourceQualityWeight(job.source);
}

/** Listing age uses ATS post time when present, else first-seen (`createdAt`). */
function ageInDays(postedAt: Date | null, createdAt: Date): number {
  const ref = postedAt ?? createdAt;
  const ms = Date.now() - ref.getTime();
  return Math.max(0, ms / (1000 * 60 * 60 * 24));
}

/**
 * Exponential decay freshness in [0, 1].
 */
export function freshnessScore(
  postedAt: Date | null,
  createdAt: Date,
  lambda: number = DEFAULT_FRESHNESS_LAMBDA,
): number {
  const age = ageInDays(postedAt, createdAt);
  return Math.exp(-lambda * age);
}

/**
 * Tokenize filter string into lowercase terms (alphanumeric + internal dots for e.g. node.js).
 */
function parseFilterTerms(query: string | undefined): string[] {
  if (!query?.trim()) return [];
  return query
    .toLowerCase()
    .split(/[\s,]+/)
    .map((t) => t.replace(/[^\w.]/g, ""))
    .filter(Boolean);
}

/**
 * Simple relevance: +1 per matched term in title (capped), +bonus for remote/country heuristics.
 */
export function titleRelevanceScore(
  title: string,
  country: string | null,
  isRemote: boolean,
  filters: JobRankingFilters,
): number {
  const terms = parseFilterTerms(filters.query);
  if (terms.length === 0) return 0.5;

  const t = title.toLowerCase();
  const locNorm = (country ?? "").toLowerCase();
  let hits = 0;
  for (const term of terms) {
    if (term === "remote" && isRemote) {
      hits += 1;
      continue;
    }
    if (term.length >= 2 && locNorm.includes(term)) {
      hits += 1;
      continue;
    }
    if (term.length >= 2 && t.includes(term)) {
      hits += 1;
    }
  }
  const maxHits = terms.length + 2;
  return Math.min(1, hits / Math.max(1, maxHits * 0.5));
}

function totalScore(
  f: number,
  s: number,
  r: number,
  weights: JobRankingWeights,
): number {
  return f * weights.freshness + s * weights.sourceQuality + r * weights.titleRelevance;
}

/**
 * Pure ranking: no I/O. Sort descending by weighted score.
 */
export function rankJobs<J extends Job>(
  jobs: J[],
  filters: JobRankingFilters,
  weights: JobRankingWeights = DEFAULT_RANKING_WEIGHTS,
  lambda: number = DEFAULT_FRESHNESS_LAMBDA,
): RankedJob<J>[] {
  const ranked: RankedJob<J>[] = jobs.map((job) => {
    const f = freshnessForRanking(job, lambda);
    const s = sourceForRanking(job);
    const r = titleRelevanceScore(job.title, job.country, job.isRemote, filters);
    const score = totalScore(f, s, r, weights);
    return { job, score, freshnessScore: f, sourceQualityScore: s, titleRelevanceScore: r };
  });
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}
