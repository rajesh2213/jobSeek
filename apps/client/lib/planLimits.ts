/**
 * Free tier daily job allowance — keep in sync with
 * `apps/server/src/modules/viewCap/viewCap.service.ts` (`FREE_DAILY_JOBS`) and
 * `discoveryCap.ts` / `jobListCap.ts` (2×10 list cap before preview).
 */
export const FREE_DAILY_JOBS = 20;

const _FREE_DISCOVERY_SEARCHES = 2;
export const FREE_DISCOVERY = {
  searches: _FREE_DISCOVERY_SEARCHES,
  /** `searches × jobsPerSearch` = `FREE_DAILY_JOBS` (20). */
  jobsPerSearch: FREE_DAILY_JOBS / _FREE_DISCOVERY_SEARCHES,
  /** Teaser rows after daily discovery is exhausted. */
  previewRows: 2,
} as const;

/** @deprecated use FREE_DISCOVERY.previewRows */
export const FREE_DISCOVERY_PREVIEW_JOB_ROWS = FREE_DISCOVERY.previewRows;

/** Full job post opens per UTC day — same pool size as list cap (20). */
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
