import type { JobItem } from "./api";
import { fetchJobById } from "./api";
import { jobHasMatchSignals } from "./resumeScorer";

const CACHE_PREFIX = "resumeFitHydrated:";

function cacheKey(jobId: string): string {
  return `${CACHE_PREFIX}${jobId}`;
}

/** Session-scoped hydrated job payload for fit scoring. */
export function readHydratedJob(jobId: string): JobItem | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(cacheKey(jobId));
    if (!raw) return null;
    return JSON.parse(raw) as JobItem;
  } catch {
    return null;
  }
}

export function writeHydratedJob(jobId: string, job: JobItem): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(cacheKey(jobId), JSON.stringify(job));
  } catch {
    // quota exceeded — ignore
  }
}

export function logResumeFitHydrate(payload: {
  jobId: string;
  fetchMs: number;
  scoreMs?: number;
  confidence?: string | null;
  hydrated: boolean;
}): void {
  if (process.env.NODE_ENV !== "development") return;
  console.info("[ResumeFitHydrate]", payload);
}

/**
 * Resolve job for scoring: use list payload when sufficient; otherwise fetch detail once and cache.
 */
export async function resolveJobForFitScoring(
  listJob: JobItem,
  getToken: () => Promise<string | null>,
): Promise<{ job: JobItem; hydrated: boolean; fetchMs: number }> {
  if (jobHasMatchSignals(listJob)) {
    return { job: listJob, hydrated: false, fetchMs: 0 };
  }

  const cached = readHydratedJob(listJob.id);
  if (cached && jobHasMatchSignals(cached)) {
    return { job: cached, hydrated: true, fetchMs: 0 };
  }

  const t0 = performance.now();
  const token = await getToken();
  const res = await fetchJobById(listJob.id, { token });
  const fetchMs = Math.round(performance.now() - t0);

  if (!res?.data) {
    return { job: listJob, hydrated: false, fetchMs };
  }

  writeHydratedJob(listJob.id, res.data);
  return { job: res.data, hydrated: true, fetchMs };
}
