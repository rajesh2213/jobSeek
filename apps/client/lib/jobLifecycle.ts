import type { JobItem } from "./api";

type JobLifecycleFields = Pick<JobItem, "isActive" | "expiresAt">;

/** Explicit inactive flag from the API (`isActive === false`). Undefined defaults to active. */
export function isJobInactive(job: JobLifecycleFields): boolean {
  return job.isActive === false;
}

/** True when `expiresAt` is a valid timestamp at or before `now`. Missing/invalid dates are not expired. */
export function isJobExpired(job: JobLifecycleFields, now: Date = new Date()): boolean {
  const raw = job.expiresAt;
  if (raw == null || raw === "") return false;
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) return false;
  return ts <= now.getTime();
}

/** Whether the job should be treated as publicly indexable for SEO (detail page + structured data). */
export function isJobSeoActive(job: JobLifecycleFields, now: Date = new Date()): boolean {
  if (isJobInactive(job)) return false;
  if (isJobExpired(job, now)) return false;
  return true;
}

export function shouldIndexJob(job: JobLifecycleFields, now: Date = new Date()): boolean {
  return isJobSeoActive(job, now);
}
