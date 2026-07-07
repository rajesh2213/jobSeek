const WORKDAY_TIMEOUT_SMALL_MS = 120_000;
const WORKDAY_TIMEOUT_MEDIUM_MS = 180_000;
const WORKDAY_TIMEOUT_LARGE_MS = 300_000;
const WORKDAY_TIMEOUT_XLARGE_MS = 600_000;

function envBaseTimeoutMs(): number {
  const n = Number(process.env.ATS_WORKDAY_FETCH_TIMEOUT_MS ?? "120000");
  if (!Number.isFinite(n)) return WORKDAY_TIMEOUT_SMALL_MS;
  return Math.max(30_000, Math.min(600_000, Math.floor(n)));
}

/**
 * Adaptive wall-clock timeout for a full Workday board fetch.
 * Scales with estimated board size; never below env base.
 */
export function computeWorkdayAdaptiveFetchTimeoutMs(
  estimatedJobCount: number | null | undefined,
): number {
  const base = envBaseTimeoutMs();
  const n = estimatedJobCount ?? 0;
  if (n <= 0) return base;
  if (n <= 200) return Math.max(base, WORKDAY_TIMEOUT_SMALL_MS);
  if (n <= 500) return Math.max(base, WORKDAY_TIMEOUT_MEDIUM_MS);
  if (n <= 1000) return Math.max(base, WORKDAY_TIMEOUT_LARGE_MS);
  return Math.max(base, WORKDAY_TIMEOUT_XLARGE_MS);
}

/** Remaining listing pages × per-page budget for in-crawl deadline extension. */
export function computeWorkdayRemainingWorkTimeoutMs(
  jobsFetchedSoFar: number,
  totalReported: number | null | undefined,
  perJobBudgetMs = 180,
): number {
  const total = totalReported ?? jobsFetchedSoFar;
  const remaining = Math.max(0, total - jobsFetchedSoFar);
  const detailConcurrency = 5;
  const listingPagesRemaining = Math.ceil(remaining / 20);
  const listingMs = listingPagesRemaining * 3_000;
  const detailMs = Math.ceil(remaining / detailConcurrency) * perJobBudgetMs;
  return listingMs + detailMs + 30_000;
}
