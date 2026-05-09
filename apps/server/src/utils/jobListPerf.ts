import { performance } from "node:perf_hooks";
import { logger } from "./logger.js";

export type JobListPerfEvent = "JOB_LIST_QUERY_IDS" | "JOB_LIST_HYDRATE" | "JOB_LIST_REORDER" | "JOB_LIST_TOTAL";

/** When `DEBUG_JOB_LIST_PERF=1`, emit structured timing for `findManyCanonicalFiltered`. */
export function isJobListPerfDebugEnabled(): boolean {
  return process.env.DEBUG_JOB_LIST_PERF?.trim() === "1";
}

/**
 * When set (milliseconds, > 0), emit a single structured `JOB_LIST_SLOW` log per listing request
 * whose total listing time exceeds this threshold. Independent of `DEBUG_JOB_LIST_PERF`.
 */
export function getJobListSlowThresholdMs(): number {
  const raw = process.env.JOB_LIST_SLOW_THRESHOLD_MS?.trim();
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function logJobListPerf(
  event: JobListPerfEvent,
  fields: Record<string, string | number | boolean | null | undefined>,
): void {
  if (!isJobListPerfDebugEnabled()) return;
  logger.info({ event, ...fields }, "job_list_perf");
}

/** Production-safe slow-path log (rate: at most once per slow listing request). */
export function logJobListSlow(fields: Record<string, unknown>): void {
  logger.warn({ event: "JOB_LIST_SLOW", ...fields }, "job_list_slow");
}

export function nowPerfMs(): number {
  return performance.now();
}
