export const PLAN_LIMITS = {
  free: { dailyJobViews: 10, smartApplyJobs: 0, savedSearches: 0 },
  pro: { dailyJobViews: Infinity, smartApplyJobs: 5, savedSearches: 3 },
  pro_plus: { dailyJobViews: Infinity, smartApplyJobs: 25, savedSearches: 10 },
} as const;

export type Plan = keyof typeof PLAN_LIMITS;

export function getPlanLimits(plan: string) {
  return PLAN_LIMITS[plan as Plan] ?? PLAN_LIMITS.free;
}

export function isPro(plan: string): boolean {
  return plan === "pro" || plan === "pro_plus";
}

export function isProPlus(plan: string): boolean {
  return plan === "pro_plus";
}
