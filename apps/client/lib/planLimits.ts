export const PLAN_LIMITS = {
  free: { dailyJobViews: 10, smartApplyJobs: 0, savedSearches: 3 },
  pro: { dailyJobViews: Infinity, smartApplyJobs: 5, savedSearches: 3 },
} as const;

export type Plan = keyof typeof PLAN_LIMITS;

export function getPlanLimits(plan: string) {
  return PLAN_LIMITS[plan as Plan] ?? PLAN_LIMITS.free;
}

export function isPro(plan: string): boolean {
  return plan === "pro";
}
