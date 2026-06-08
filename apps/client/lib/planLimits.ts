function intFromEnv(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export const FREE_DAILY_JOBS = intFromEnv(
  process.env.NEXT_PUBLIC_FREE_TIER_DAILY_LIMIT,
  100,
);

/** Free signed-in: AI resume–job semantic scores per rolling ~24h (must match server `FREE_RESUME_MATCH_AI_PER_24H`). */
export const FREE_RESUME_MATCH_AI_PER_24H = intFromEnv(
  process.env.NEXT_PUBLIC_FREE_RESUME_MATCH_AI_PER_24H,
  3,
);

const _FREE_DISCOVERY_PREVIEW_ROWS = intFromEnv(
  process.env.NEXT_PUBLIC_FREE_DISCOVERY_PREVIEW_ROWS,
  10,
);
export const FREE_DISCOVERY = {
  dailyJobs: FREE_DAILY_JOBS,
  /** Teaser rows after daily discovery is exhausted. */
  previewRows: _FREE_DISCOVERY_PREVIEW_ROWS,
} as const;

/** @deprecated use FREE_DISCOVERY.previewRows */
export const FREE_DISCOVERY_PREVIEW_JOB_ROWS = FREE_DISCOVERY.previewRows;

/** Full job post opens per UTC day — same pool size as list cap. */
export const FREE_DAILY_JOB_POST_VIEWS = FREE_DAILY_JOBS;

export const PLAN_LIMITS = {
  free: {
    dailyJobViews: FREE_DAILY_JOBS,
    smartApplyJobs: 0,
    savedSearches: 3,
  },
  pro: { dailyJobViews: Infinity, smartApplyJobs: 5, savedSearches: 3 },
} as const;

export type Plan = keyof typeof PLAN_LIMITS;

export function getPlanLimits(plan: string) {
  return PLAN_LIMITS[plan as Plan] ?? PLAN_LIMITS.free;
}

export function isPro(plan: string): boolean {
  return plan === "pro";
}
