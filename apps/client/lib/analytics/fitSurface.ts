/** Where a fit check or apply action originated (Phase 8C experiment surfaces). */
export const FIT_SURFACES = [
  "main_feed",
  "recommended_carousel",
  "similar_jobs",
  "company_hub",
] as const;

export type FitSurface = (typeof FIT_SURFACES)[number];

const SESSION_KEY_PREFIX = "jobseek:fit-surface:";

export function isFitSurface(value: string): value is FitSurface {
  return (FIT_SURFACES as readonly string[]).includes(value);
}

/** Persist surface for a job so job-detail fit/apply inherits carousel/feed context. */
export function rememberFitSurface(jobId: string, surface: FitSurface): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(`${SESSION_KEY_PREFIX}${jobId}`, surface);
  } catch {
    /* ignore */
  }
}

/** Resolve surface: explicit prop → session (from navigation) → default. */
export function resolveFitSurface(jobId: string, explicit?: FitSurface): FitSurface {
  if (explicit) return explicit;
  if (typeof window === "undefined") return "main_feed";
  try {
    const stored = sessionStorage.getItem(`${SESSION_KEY_PREFIX}${jobId}`);
    if (stored && isFitSurface(stored)) return stored;
  } catch {
    /* ignore */
  }
  return "main_feed";
}
