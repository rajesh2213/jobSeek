/** ~6 months — beyond this, show calendar date instead of "N days/weeks ago". */
const SIX_MONTHS_MS = 183 * 86400000;

function shortPostedDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

/** Human-readable relative posting time (no external date libs). */
export function formatPostedTime(iso: string | null | undefined): string {
  return formatTimeAgo(iso);
}

/**
 * Relative freshness: "5 minutes ago", "2 hours ago", "3 days ago".
 * Uses `postedAt` from ATS when present, otherwise `createdAt` (first seen).
 * Dates older than ~6 months use a short calendar date.
 * When falling back to `createdAt` (no `postedAt`), appends "*" for debugging.
 */
export function formatTimeAgo(
  postedAt: string | null | undefined,
  createdAt?: string | null,
): string {
  const hasPosted =
    postedAt != null && String(postedAt).trim() !== "" && postedAt !== "null";
  const iso = hasPosted ? postedAt : createdAt;
  const crawlTimeFallback =
    !hasPosted && Boolean(createdAt && String(createdAt).trim());
  const star = crawlTimeFallback ? "*" : "";

  if (!iso) return "Recently posted";

  const posted = new Date(iso);
  if (Number.isNaN(posted.getTime())) return "Recently posted";

  const now = Date.now();
  const diffMs = now - posted.getTime();

  if (diffMs > SIX_MONTHS_MS) {
    return `${shortPostedDate(posted)}${star}`;
  }

  const diffM = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffMs / 86400000);

  if (diffM < 1) return `Just now${star}`;
  if (diffM < 60) {
    return `${diffM} minute${diffM === 1 ? "" : "s"} ago${star}`;
  }
  if (diffH < 24) {
    return `${diffH} hour${diffH === 1 ? "" : "s"} ago${star}`;
  }
  if (diffD === 1) return `Yesterday${star}`;
  if (diffD < 7) return `${diffD} days ago${star}`;
  if (diffD < 30) return `${Math.floor(diffD / 7)} weeks ago${star}`;
  return `${shortPostedDate(posted)}${star}`;
}

/** Format annual salary floor for display (USD). */
export function formatSalaryUsd(min: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(min);
}
