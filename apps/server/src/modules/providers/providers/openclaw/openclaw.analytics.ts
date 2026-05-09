/**
 * OpenClaw Redis counters (hash per UTC day). Field names are stable for dashboards.
 * - malformed_job_rows: mapper rejected (bad URL, oversize title, etc.)
 * - schema_rejects: legacy / reserved; prefer malformed_job_rows + failures for new dashboards
 */
import type { Redis } from "ioredis";
import { logger } from "../../../../utils/logger.js";
import { openClawQuotaRedisKey } from "./openclaw.quota.js";

function metricsKey(date = new Date()): string {
  return `openclaw:metrics:${openClawQuotaRedisKey(date).replace("openclaw:quota:", "")}`;
}

export async function incrOpenClawMetric(
  redis: Redis | null,
  field:
    | "requests"
    | "jobs_normalized"
    | "jobs_merged"
    | "jobs_new_canonical"
    | "companies_discovered"
    | "ats_hints_applied"
    | "failures"
    | "http_401"
    | "http_403"
    | "http_429"
    | "timeouts"
    | "schema_rejects"
    /** Mapper validation failures (invalid URL, bad apply link, oversize fields, etc.). */
    | "malformed_job_rows",
  by = 1,
): Promise<void> {
  if (!redis || by === 0) return;
  try {
    const key = metricsKey();
    await redis.hincrby(key, field, by);
    await redis.pexpire(key, 36 * 60 * 60 * 1000);
  } catch (err) {
    logger.warn(
      { event: "openclaw_metrics_redis_failed", provider: "openclaw", field, err },
      "openclaw_metrics_redis_failed",
    );
  }
}

export type OpenClawMetricsHash = Partial<
  Record<
    | "requests"
    | "jobs_normalized"
    | "jobs_merged"
    | "jobs_new_canonical"
    | "companies_discovered"
    | "ats_hints_applied"
    | "failures"
    | "http_401"
    | "http_403"
    | "http_429"
    | "timeouts"
    | "schema_rejects"
    | "malformed_job_rows",
    string
  >
>;

export async function readOpenClawMetricsHash(redis: Redis | null): Promise<OpenClawMetricsHash> {
  if (!redis) return {};
  try {
    return (await redis.hgetall(metricsKey())) as OpenClawMetricsHash;
  } catch {
    return {};
  }
}
