/**
 * List / discovery metering — keep in sync with
 * `apps/server/src/modules/viewCap/discoveryCap.ts` and `jobListCap.ts`.
 */
export const FREE_DISCOVERY = {
  searches: 2,
  jobsPerSearch: 10,
  /** Teaser rows after daily discovery is exhausted. */
  previewRows: 2,
} as const;

/** @deprecated use FREE_DISCOVERY.previewRows */
export const FREE_DISCOVERY_PREVIEW_JOB_ROWS = FREE_DISCOVERY.previewRows;

/**
 * Full job post (GET /jobs/:id) views per UTC day — keep in sync with
 * `viewCap.service.ts` `FREE_DAILY_JOB_VIEWS`.
 */
export const FREE_DAILY_JOB_POST_VIEWS = 10;

export const PLAN_LIMITS = {
  free: {
    /** Job **detail** opens per day (not the same as list discovery). */
    dailyJobViews: FREE_DAILY_JOB_POST_VIEWS,
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
