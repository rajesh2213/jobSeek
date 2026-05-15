/**
 * OpenClaw Redis counters (hash per UTC day). Field names are stable for dashboards.
 * - malformed_job_rows: mapper rejected (bad URL, oversize title, etc.)
 * - schema_rejects: legacy / reserved; prefer malformed_job_rows + failures for new dashboards
 */
import type { Redis } from "ioredis";
import { logger } from "../../../../utils/logger.js";
import { openClawQuotaRedisKey } from "./openclaw.quota.js";
import type { OpenClawShadowEvalResult } from "./openclaw.parseShadow.js";
import type { OpenClawAtsDiscoveryEvalResult } from "./openclaw.atsDiscovery.js";

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

/** OpenClaw ATS endpoint discovery shadow counters. */
export type OpenClawAtsDiscoveryMetricField =
  | "ats_discovery_evaluated"
  | "ats_discovery_supported"
  | "ats_discovery_rejected"
  | "ats_discovery_existing_endpoint"
  | "ats_discovery_candidate_would_create"
  | "ats_discovery_reject_unknown_host"
  | "ats_discovery_reject_existing_endpoint"
  | "ats_discovery_reject_invalid_url"
  | "ats_discovery_reject_unsupported_ats"
  | "ats_discovery_reject_missing_company"
  | "ats_discovery_reject_ambiguous_endpoint"
  | "ats_discovery_reject_slug_extraction_failed"
  | "ats_discovery_reject_empty_base_url"
  | "ats_discovery_canonical_collision";

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
  | OpenClawShadowMetricField
  | OpenClawAtsDiscoveryMetricField;

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

function atsDiscoveryRejectMetric(
  reason: string,
): OpenClawAtsDiscoveryMetricField | null {
  switch (reason) {
    case "unknown_host":
      return "ats_discovery_reject_unknown_host";
    case "invalid_url":
      return "ats_discovery_reject_invalid_url";
    case "unsupported_ats":
      return "ats_discovery_reject_unsupported_ats";
    case "missing_company":
      return "ats_discovery_reject_missing_company";
    case "existing_endpoint":
      return "ats_discovery_reject_existing_endpoint";
    case "ambiguous_endpoint":
      return "ats_discovery_reject_ambiguous_endpoint";
    case "slug_extraction_failed":
      return "ats_discovery_reject_slug_extraction_failed";
    case "empty_base_url":
      return "ats_discovery_reject_empty_base_url";
    default:
      return null;
  }
}

/**
 * Record ATS endpoint discovery shadow outcome (Redis counters only).
 * Does not create endpoints or enqueue crawls.
 */
export async function recordOpenClawAtsDiscoveryEval(
  redis: Redis | null,
  result: OpenClawAtsDiscoveryEvalResult,
): Promise<void> {
  await incrOpenClawMetric(redis, "ats_discovery_evaluated", 1);

  const o = result.outcome;
  if (o.status === "rejected") {
    await incrOpenClawMetric(redis, "ats_discovery_rejected", 1);
    const sub = atsDiscoveryRejectMetric(o.reason);
    if (sub) await incrOpenClawMetric(redis, sub, 1);
    return;
  }

  await incrOpenClawMetric(redis, "ats_discovery_supported", 1);

  if (o.status === "would_create") {
    await incrOpenClawMetric(redis, "ats_discovery_candidate_would_create", 1);
  } else if (o.status === "existing_endpoint") {
    await incrOpenClawMetric(redis, "ats_discovery_existing_endpoint", 1);
  }

  if (result.canonicalCollision) {
    await incrOpenClawMetric(redis, "ats_discovery_canonical_collision", 1);
  }
}

export async function readOpenClawMetricsHash(redis: Redis | null): Promise<OpenClawMetricsHash> {
  if (!redis) return {};
  try {
    return (await redis.hgetall(metricsKey())) as OpenClawMetricsHash;
  } catch {
    return {};
  }
}
