import type { JobItem } from "./api";

type JobLifecycleFields = Pick<JobItem, "isActive" | "expiresAt">;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * SEO grace after business expiry (OG-1.2 / OG-1.4).
 * Prefer `NEXT_PUBLIC_SEO_JOB_GRACE_DAYS` so client + SSR share one value; fall back to
 * server-only `SEO_JOB_GRACE_DAYS` during SSR.
 */
export function getSeoJobGraceDays(): number {
  const raw =
    process.env.NEXT_PUBLIC_SEO_JOB_GRACE_DAYS?.trim() ||
    process.env.SEO_JOB_GRACE_DAYS?.trim() ||
    "12";
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 12;
  return Math.min(parsed, 90);
}

export function getSeoJobGraceMs(): number {
  return getSeoJobGraceDays() * DAY_MS;
}

function parseExpiresAtMs(expiresAt: JobLifecycleFields["expiresAt"]): number | null {
  if (expiresAt == null || expiresAt === "") return null;
  const ts = Date.parse(String(expiresAt));
  if (Number.isNaN(ts)) return null;
  return ts;
}

/** Explicit inactive flag from the API (`isActive === false`). Undefined defaults to active. */
export function isJobInactive(job: JobLifecycleFields): boolean {
  return job.isActive === false;
}

/** True when `expiresAt` is a valid timestamp at or before `now`. Missing/invalid dates are not expired. */
export function isJobExpired(job: JobLifecycleFields, now: Date = new Date()): boolean {
  const ts = parseExpiresAtMs(job.expiresAt);
  if (ts == null) return false;
  return ts <= now.getTime();
}

/**
 * Business-open for Apply CTA / "open" badge (OG-1.4).
 * Uses real `isActive` + `expiresAt` — no SEO grace.
 */
export function isJobBusinessOpen(job: JobLifecycleFields, now: Date = new Date()): boolean {
  if (isJobInactive(job)) return false;
  if (isJobExpired(job, now)) return false;
  return true;
}

/**
 * SEO-active for robots/index (OG-1.2 / OG-1.4).
 * When `expiresAt` is set, SEO TTL = expiresAt + SEO_JOB_GRACE_DAYS (decoupled from
 * `isActive`, which the purge worker may flip false at business expiry).
 * Without `expiresAt`, falls back to `isActive`.
 */
export function isJobSeoActive(job: JobLifecycleFields, now: Date = new Date()): boolean {
  const ts = parseExpiresAtMs(job.expiresAt);
  if (ts != null) {
    return now.getTime() < ts + getSeoJobGraceMs();
  }
  return !isJobInactive(job);
}

/** True when the job is past business expiry but still inside the SEO grace window. */
export function isJobInSeoGrace(job: JobLifecycleFields, now: Date = new Date()): boolean {
  return !isJobBusinessOpen(job, now) && isJobSeoActive(job, now);
}

export function shouldIndexJob(job: JobLifecycleFields, now: Date = new Date()): boolean {
  return isJobSeoActive(job, now);
}
