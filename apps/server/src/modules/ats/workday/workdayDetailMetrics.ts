/**
 * In-process Workday SEO / detail-fetch counters (structured logs + snapshot).
 * Aggregate via log pipeline or export from metrics scripts in multi-instance deploys.
 */

import { logger } from "../../../utils/logger.js";

const PROVIDER = "workday";

type CounterMap = Record<string, number>;

const counters: CounterMap = {
  workday_detail_success_total: 0,
  workday_detail_failure_total: 0,
  workday_detail_timeout_total: 0,
  workday_detail_retry_total: 0,
  workday_detail_http429_total: 0,
  workday_repair_success_total: 0,
  workday_repair_failed_total: 0,
  publishable_jobs_total: 0,
  workday_root_path_jobs_total: 0,
  workday_empty_description_total: 0,
  hash_cache_repairs_total: 0,
  workday_repair_source_url_collision_total: 0,
  workday_repair_collision_merged_total: 0,
};

export function resetWorkdayDetailMetrics(): void {
  for (const key of Object.keys(counters)) counters[key] = 0;
}

function bump(metric: keyof typeof counters, by = 1): void {
  counters[metric] += by;
}

export function recordWorkdayDetailSuccess(): void {
  bump("workday_detail_success_total");
}

export function recordWorkdayDetailFailure(reason: string): void {
  bump("workday_detail_failure_total");
  if (reason === "timeout") bump("workday_detail_timeout_total");
  if (reason === "http_429") bump("workday_detail_http429_total");
}

export function recordWorkdayDetailRetry(): void {
  bump("workday_detail_retry_total");
}

export function recordWorkdayRepairSuccess(): void {
  bump("workday_repair_success_total");
}

export function recordWorkdayRepairFailed(): void {
  bump("workday_repair_failed_total");
}

export function recordHashCacheRepair(): void {
  bump("hash_cache_repairs_total");
}

export function recordWorkdayRepairSourceUrlCollision(): void {
  bump("workday_repair_source_url_collision_total");
}

export function recordWorkdayRepairCollisionMerged(): void {
  bump("workday_repair_collision_merged_total");
}

export function setWorkdaySeoGaugeCounts(input: {
  publishableJobs: number;
  workdayRootPathJobs: number;
  workdayEmptyDescriptionJobs: number;
}): void {
  counters.publishable_jobs_total = input.publishableJobs;
  counters.workday_root_path_jobs_total = input.workdayRootPathJobs;
  counters.workday_empty_description_total = input.workdayEmptyDescriptionJobs;
}

export function getWorkdayDetailMetricsSnapshot(): Record<string, number | string> {
  return { ...counters, provider: PROVIDER };
}

export function logWorkdayDetailMetricsSnapshot(event = "workday_seo_metrics"): void {
  logger.info(
    { event, ...getWorkdayDetailMetricsSnapshot() },
    event,
  );
}
