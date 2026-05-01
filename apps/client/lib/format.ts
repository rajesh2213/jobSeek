/** ~6 months — beyond this, show calendar date instead of "N days/weeks ago". */
const SIX_MONTHS_MS = 183 * 86400000;

function shortPostedDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

function parseInstant(timestamp: string | Date | null | undefined): Date | null {
  if (timestamp == null) return null;
  if (timestamp instanceof Date) {
    return Number.isNaN(timestamp.getTime()) ? null : timestamp;
  }
  const s = String(timestamp).trim();
  if (!s || s === "null") return null;
  const posted = new Date(s);
  if (Number.isNaN(posted.getTime())) return null;
  return posted;
}

/** Core relative-time formatter for a single instant (listing/detail freshness). */
function timeAgo(timestamp: string | Date | null | undefined): string {
  const posted = parseInstant(timestamp);
  if (!posted) return "Recently posted";

  const now = Date.now();
  const diffMs = now - posted.getTime();

  if (diffMs > SIX_MONTHS_MS) {
    return shortPostedDate(posted);
  }

  const diffM = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffMs / 86400000);

  if (diffM < 1) return "Just now";
  if (diffM < 60) {
    return `${diffM} minute${diffM === 1 ? "" : "s"} ago`;
  }
  if (diffH < 24) {
    return `${diffH} hour${diffH === 1 ? "" : "s"} ago`;
  }
  if (diffD === 1) return "Yesterday";
  if (diffD < 7) return `${diffD} days ago`;
  if (diffD < 30) return `${Math.floor(diffD / 7)} weeks ago`;
  return shortPostedDate(posted);
}

/** Human-readable relative posting time (no external date libs). */
export function formatPostedTime(iso: string | null | undefined): string {
  return formatTimeAgo(iso);
}

/**
 * Relative freshness: "5 minutes ago", "2 hours ago", "3 days ago".
 * Pass the same instant as listing sort (`effectivePostedAt ?? createdAt` ≡ DB `listingFreshnessAt`).
 * Dates older than ~6 months use a short calendar date.
 */
export function formatTimeAgo(timestamp: string | Date | null | undefined): string {
  return timeAgo(timestamp);
}

/** Format annual salary floor for USD display. */
export function formatSalaryUsd(min: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(min);
}
