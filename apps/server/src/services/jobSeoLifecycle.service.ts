/**
 * Mirrors client `apps/client/lib/jobLifecycle.ts` SEO rules (OG-1.2 / OG-1.4).
 *
 * Business TTL (Apply CTA / open badge): `isActive` + raw `expiresAt`
 *   → set by `jobRetentionPolicy.service` (ATS 21d / other 45d via JOB_*_TTL_DAYS).
 * SEO TTL: `expiresAt + SEO_JOB_GRACE_DAYS` for robots/index/cache only.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type JobSeoLifecycleFields = {
  isActive?: boolean | null;
  expiresAt?: Date | string | null;
};

export function getSeoJobGraceDays(): number {
  const raw = process.env.SEO_JOB_GRACE_DAYS?.trim() || "12";
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 12;
  return Math.min(parsed, 90);
}

export function getSeoJobGraceMs(): number {
  return getSeoJobGraceDays() * DAY_MS;
}

function parseExpiresAtMs(expiresAt: JobSeoLifecycleFields["expiresAt"]): number | null {
  if (expiresAt == null || expiresAt === "") return null;
  const ts = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(String(expiresAt));
  if (Number.isNaN(ts)) return null;
  return ts;
}

/** Business-open — no SEO grace. */
export function isJobBusinessOpen(fields: JobSeoLifecycleFields, now: Date = new Date()): boolean {
  if (fields.isActive === false) return false;
  const ts = parseExpiresAtMs(fields.expiresAt);
  if (ts != null && ts <= now.getTime()) return false;
  return true;
}

/**
 * Whether the job should be treated as publicly indexable / cacheable for SEO.
 * When `expiresAt` is set, ignores `isActive` so expiry-marking does not kill indexability
 * during the grace window.
 */
export function isJobSeoActive(fields: JobSeoLifecycleFields, now: Date = new Date()): boolean {
  const ts = parseExpiresAtMs(fields.expiresAt);
  if (ts != null) {
    return now.getTime() < ts + getSeoJobGraceMs();
  }
  return fields.isActive !== false;
}
