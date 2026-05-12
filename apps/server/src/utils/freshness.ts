/**
 * Single source of truth for "is this date a real publish date or a discovery proxy".
 *
 * The semantics are deliberately backend-owned so the web app, the extension, growth
 * emails, JSON-LD generators, and sitemap builders all agree on what "Posted" vs
 * "Added" means. Frontends must NOT infer this from `postedAt != null` themselves;
 * they should consume the `Freshness` object returned by the API.
 *
 * Schema mapping (no-DDL):
 *   - postedAt IS NOT NULL  →  freshness.source = POSTED,     label = "Posted"
 *   - postedAt IS NULL      →  freshness.source = DISCOVERED, label = "Added"
 *
 * `timestamp` is the same instant used by the listing sort key
 * (`Job.listingFreshnessAt` = COALESCE(postedAt, createdAt)).
 */

export const FRESHNESS_SOURCES = ["POSTED", "DISCOVERED"] as const;
export type FreshnessSource = (typeof FRESHNESS_SOURCES)[number];

export const FRESHNESS_LABELS: Record<FreshnessSource, "Posted" | "Added"> = {
  POSTED: "Posted",
  DISCOVERED: "Added",
};

/** Minimal row shape needed to derive freshness. */
export interface FreshnessInput {
  postedAt: Date | string | null | undefined;
  createdAt: Date | string;
}

export interface Freshness {
  source: FreshnessSource;
  /** Prefix word for UI; localizable later. */
  label: "Posted" | "Added";
  /** ISO string for client-side relative formatting. */
  timestamp: string;
  /** Server-rendered "Posted 3 hours ago" — useful for SSR / email / JSON-LD. */
  relative: string;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "null") return null;
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** ≈6 months — beyond this the relative formatter falls back to a short calendar date. */
const SIX_MONTHS_MS = 183 * 86400000;

function shortDate(d: Date, now: Date): string {
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
}

/**
 * Compose a stable, human-readable phrase ("Posted 3 hours ago", "Added on Jan 12").
 * Mirrors `apps/client/lib/format.ts:formatTimeAgo` so server-rendered text matches
 * client-rendered text bit-for-bit when the ticker hasn't elapsed.
 */
export function formatRelativeFreshness(label: "Posted" | "Added", timestamp: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - timestamp.getTime();
  if (diffMs > SIX_MONTHS_MS) {
    return `${label} on ${shortDate(timestamp, now)}`;
  }
  const diffM = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffMs / 86400000);
  if (diffM < 1) return `${label} just now`;
  if (diffM < 60) return `${label} ${diffM} minute${diffM === 1 ? "" : "s"} ago`;
  if (diffH < 24) return `${label} ${diffH} hour${diffH === 1 ? "" : "s"} ago`;
  if (diffD === 1) return `${label} yesterday`;
  if (diffD < 7) return `${label} ${diffD} days ago`;
  if (diffD < 30) return `${label} ${Math.floor(diffD / 7)} weeks ago`;
  return `${label} on ${shortDate(timestamp, now)}`;
}

/**
 * Derive the canonical freshness contract for a Job row.
 *
 * Pure function — safe to call in hot mapper paths. Cost is dominated by the
 * `Intl.DateTimeFormat` cache on first use; subsequent calls are ~tens of ns.
 */
export function deriveFreshness(input: FreshnessInput, now: Date = new Date()): Freshness {
  const posted = toDate(input.postedAt);
  const created = toDate(input.createdAt);
  const source: FreshnessSource = posted ? "POSTED" : "DISCOVERED";
  const label = FRESHNESS_LABELS[source];
  /** Fallback ensures `timestamp` is always a valid ISO string, even for malformed createdAt. */
  const ts = posted ?? created ?? now;
  return {
    source,
    label,
    timestamp: ts.toISOString(),
    relative: formatRelativeFreshness(label, ts, now),
  };
}
