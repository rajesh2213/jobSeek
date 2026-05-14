/**
 * OpenClaw ATS endpoint discovery — SHADOW / CANDIDATE ONLY.
 *
 * Detects crawlable ATS providers from OpenClaw sourceUrls, evaluates whether an
 * AtsEndpoint candidate would be created, and emits metrics + logs. Does NOT create
 * endpoints, enqueue crawls, or trigger any side effects.
 *
 * Reuses the proven atsUrlParser detection and normalization from the existing
 * ATS discovery pipeline to guarantee consistency.
 */

import type { AtsType } from "../../../ats/ats.interface.js";
import {
  detectAtsTypeFromUrl,
  extractSlug,
  buildBaseUrl,
  type AtsEndpointParseResult,
} from "../../../atsDiscovery/atsUrlParser.js";

/**
 * STRICT allowlist: only these ATS types are eligible for OpenClaw discovery.
 * Intentionally narrower than CRAWLABLE_ATS_TYPES to avoid noisy or low-confidence
 * hosts (teamtailor, rippling, jobvite, smartrecruiters excluded for now).
 */
const OPENCLAW_DISCOVERY_ALLOWLIST = new Set<AtsType>([
  "workday",
  "ashby",
  "workable",
  "bamboohr",
  "greenhouse",
  "lever",
]);

export type OpenClawAtsDiscoveryRejectReason =
  | "unsupported_ats"
  | "unknown_host"
  | "invalid_url"
  | "slug_extraction_failed"
  | "ambiguous_endpoint"
  | "empty_base_url"
  | "missing_company"
  | "existing_endpoint";

export type OpenClawAtsDiscoveryOutcome =
  | { status: "supported"; candidate: AtsEndpointParseResult }
  | { status: "rejected"; reason: OpenClawAtsDiscoveryRejectReason }
  | { status: "would_create"; candidate: AtsEndpointParseResult }
  | { status: "existing_endpoint"; candidate: AtsEndpointParseResult };

export type OpenClawAtsDiscoveryEvalResult = {
  sourceUrl: string;
  detectedType: AtsType | null;
  outcome: OpenClawAtsDiscoveryOutcome;
};

/**
 * Infer ATS endpoint candidate from a sourceUrl. Pure logic — no DB, no Redis, no I/O.
 * Returns the parsed candidate or a typed reject reason.
 */
export function inferAtsCandidate(
  sourceUrl: string,
): { status: "supported"; candidate: AtsEndpointParseResult } | { status: "rejected"; reason: OpenClawAtsDiscoveryRejectReason } {
  if (!sourceUrl?.trim()) {
    return { status: "rejected", reason: "invalid_url" };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(sourceUrl.trim());
  } catch {
    return { status: "rejected", reason: "invalid_url" };
  }

  if (!parsedUrl.hostname) {
    return { status: "rejected", reason: "unknown_host" };
  }

  const detectedType = detectAtsTypeFromUrl(sourceUrl);
  if (!detectedType) {
    return { status: "rejected", reason: "unknown_host" };
  }

  if (!OPENCLAW_DISCOVERY_ALLOWLIST.has(detectedType)) {
    return { status: "rejected", reason: "unsupported_ats" };
  }

  const slug = extractSlug(sourceUrl, detectedType);
  if (!slug) {
    return { status: "rejected", reason: "slug_extraction_failed" };
  }

  if (slug.length < 2 || slug.length > 200) {
    return { status: "rejected", reason: "ambiguous_endpoint" };
  }

  const baseUrl = buildBaseUrl(detectedType, slug);
  if (!baseUrl) {
    return { status: "rejected", reason: "empty_base_url" };
  }

  return {
    status: "supported",
    candidate: {
      type: detectedType,
      slug,
      baseUrl,
      crawlToken: slug,
    },
  };
}

export type OpenClawAtsDiscoverySummary = {
  evaluated: number;
  supported: number;
  rejected: number;
  would_create: number;
  existing_endpoint: number;
  reject_breakdown: Partial<Record<OpenClawAtsDiscoveryRejectReason, number>>;
  ats_breakdown: Record<string, { would_create: number; existing: number }>;
};

export function createEmptyAtsDiscoverySummary(): OpenClawAtsDiscoverySummary {
  return {
    evaluated: 0,
    supported: 0,
    rejected: 0,
    would_create: 0,
    existing_endpoint: 0,
    reject_breakdown: {},
    ats_breakdown: {},
  };
}

export function mergeAtsDiscoveryIntoSummary(
  summary: OpenClawAtsDiscoverySummary,
  result: OpenClawAtsDiscoveryEvalResult,
): void {
  summary.evaluated += 1;

  const o = result.outcome;
  if (o.status === "rejected") {
    summary.rejected += 1;
    summary.reject_breakdown[o.reason] = (summary.reject_breakdown[o.reason] ?? 0) + 1;
    return;
  }

  summary.supported += 1;
  const atsKey = result.detectedType ?? "unknown";
  if (!summary.ats_breakdown[atsKey]) {
    summary.ats_breakdown[atsKey] = { would_create: 0, existing: 0 };
  }
  const bucket = summary.ats_breakdown[atsKey]!;

  if (o.status === "would_create") {
    summary.would_create += 1;
    bucket.would_create += 1;
  } else if (o.status === "existing_endpoint") {
    summary.existing_endpoint += 1;
    bucket.existing += 1;
  }
}
