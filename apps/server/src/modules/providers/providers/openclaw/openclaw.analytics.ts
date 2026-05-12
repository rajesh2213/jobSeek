/**
 * OpenClaw Redis counters (hash per UTC day). Field names are stable for dashboards.
 * - malformed_job_rows: mapper rejected (bad URL, oversize title, etc.)
 * - schema_rejects: legacy / reserved; prefer malformed_job_rows + failures for new dashboards
 */
import type { Redis } from "ioredis";
import { logger } from "../../../../utils/logger.js";
import { openClawQuotaRedisKey } from "./openclaw.quota.js";
import type { OpenClawShadowEvalResult } from "./openclaw.parseShadow.js";

function metricsKey(date = new Date()): string {
  return `openclaw:metrics:${openClawQuotaRedisKey(date).replace("openclaw:quota:", "")}`;
}

/** OpenClaw-only shadow parse eligibility counters (no enqueue / no parse). */
export type OpenClawShadowMetricField =
  | "parse_shadow_evaluated"
  | "parse_eligible"
  | "parse_ineligible"
  | "parse_ineligible_missing_description"
  | "parse_ineligible_description_too_short"
  | "parse_ineligible_recently_processed"
  | "parse_ineligible_existing_usable_parse"
  | "parse_ineligible_failed_status"
  | "parse_ineligible_outside_lookback"
  | "parse_ineligible_missing_source_url"
  | "parse_ineligible_content_unchanged"
  | "parse_ineligible_recent_seen"
  | "parse_ineligible_canonical_row_missing";

export type OpenClawMetricField =
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
  | "malformed_job_rows"
  | OpenClawShadowMetricField;

export async function incrOpenClawMetric(
  redis: Redis | null,
  field: OpenClawMetricField,
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

export type OpenClawMetricsHash = Partial<Record<OpenClawMetricField, string>>;

function shadowIneligibleMetric(
  reason: OpenClawShadowEvalResult["reason"],
): OpenClawShadowMetricField | null {
  switch (reason) {
    case "eligible":
      return null;
    case "missing_description":
      return "parse_ineligible_missing_description";
    case "description_too_short":
      return "parse_ineligible_description_too_short";
    case "no_reprocessing_needed":
      return "parse_ineligible_recently_processed";
    case "existing_usable_parse":
      return "parse_ineligible_existing_usable_parse";
    case "failed_status":
      return "parse_ineligible_failed_status";
    case "outside_lookback_window":
      return "parse_ineligible_outside_lookback";
    case "missing_source_url":
      return "parse_ineligible_missing_source_url";
    case "canonical_row_missing":
      return "parse_ineligible_canonical_row_missing";
    case "content_unchanged":
      return "parse_ineligible_content_unchanged";
    case "recent_seen_dedupe_window":
      return "parse_ineligible_recent_seen";
    default:
      return null;
  }
}

/**
 * Record shadow parse eligibility outcome (Redis counters only). Does not enqueue or parse.
 */
export async function recordOpenClawShadowParseEval(
  redis: Redis | null,
  result: OpenClawShadowEvalResult,
): Promise<void> {
  await incrOpenClawMetric(redis, "parse_shadow_evaluated", 1);
  if (result.eligible) {
    await incrOpenClawMetric(redis, "parse_eligible", 1);
    return;
  }
  await incrOpenClawMetric(redis, "parse_ineligible", 1);
  const sub = shadowIneligibleMetric(result.reason);
  if (sub) await incrOpenClawMetric(redis, sub, 1);
}

export async function readOpenClawMetricsHash(redis: Redis | null): Promise<OpenClawMetricsHash> {
  if (!redis) return {};
  try {
    return (await redis.hgetall(metricsKey())) as OpenClawMetricsHash;
  } catch {
    return {};
  }
}
