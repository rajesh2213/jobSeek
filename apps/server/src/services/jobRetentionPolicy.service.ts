/**
 * Business retention TTL for job rows (Apply CTA / `isActive` / `expiresAt`).
 *
 * OG-1.4: This is intentionally separate from SEO indexability.
 * - Business TTL: env-tunable ATS / other days below → `computeJobExpiresAt`
 * - SEO TTL: `expiresAt + SEO_JOB_GRACE_DAYS` in `jobSeoLifecycle.service.ts`
 *
 * Override with:
 * - `JOB_BUSINESS_TTL_DAYS_ATS` (default 21)
 * - `JOB_BUSINESS_TTL_DAYS_OTHER` (default 45)
 */

function ttlDaysFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 365);
}

const ATS_TTL_DAYS = ttlDaysFromEnv("JOB_BUSINESS_TTL_DAYS_ATS", 21);
const OTHER_TTL_DAYS = ttlDaysFromEnv("JOB_BUSINESS_TTL_DAYS_OTHER", 45);

const ATS_SOURCES = new Set([
  "greenhouse",
  "lever",
  "ashby",
  "jobvite",
  "workable",
  "smartrecruiters",
  "bamboohr",
  "teamtailor",
  "rippling",
  "workday",
]);

const DAY_MS = 24 * 60 * 60 * 1000;

export function ttlDaysForSource(source: string): number {
  const normalized = source.trim().toLowerCase();
  return ATS_SOURCES.has(normalized) ? ATS_TTL_DAYS : OTHER_TTL_DAYS;
}

export function computeJobExpiresAt(input: {
  source: string;
  lastSeenAt: Date;
}): Date {
  const ttlDays = ttlDaysForSource(input.source);
  return new Date(input.lastSeenAt.getTime() + ttlDays * DAY_MS);
}
