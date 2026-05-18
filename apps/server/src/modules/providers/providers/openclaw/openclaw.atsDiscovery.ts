/**
 * OpenClaw ATS endpoint discovery — SHADOW / CANDIDATE ONLY.
 *
 * Detects crawlable ATS providers from OpenClaw sourceUrls, evaluates whether an
 * AtsEndpoint candidate would be created, and emits metrics + logs. Does NOT create
 * endpoints, enqueue crawls, or trigger any side effects.
 *
 * Uses OpenClaw-specific board-level normalization (stricter than shared atsUrlParser
 * job-level extraction) to avoid endpoint fragmentation.
 */

import type { AtsType } from "../../../ats/ats.interface.js";
import {
  detectAtsTypeFromUrl,
  extractSlug,
  buildBaseUrl,
  buildWorkdaySlug,
  asciiSafeLower,
  type AtsEndpointParseResult,
  type WorkdayTokenParts,
} from "../../../atsDiscovery/atsUrlParser.js";
import { normalizeAtsUrl } from "../../../../utils/normalizeAtsUrl.js";

/**
 * STRICT allowlist: only these ATS types are eligible for OpenClaw discovery.
 */
const OPENCLAW_DISCOVERY_ALLOWLIST = new Set<AtsType>([
  "workday",
  "ashby",
  "workable",
  "bamboohr",
  "greenhouse",
  "lever",
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  /** Stable board/listing URL for observability (host-level for Workday). */
  canonicalBoardUrl?: string | null;
  /** Whether this eval duplicated a prior canonical key in the same sync. */
  canonicalCollision?: boolean;
};

/** Per-sync tracker for canonical key uniqueness (in-memory only). */
export type OpenClawAtsDiscoveryCanonicalTracker = {
  seenKeys: Set<string>;
  collisions: number;
  uniqueSupportedKeys: number;
};

export function createCanonicalTracker(): OpenClawAtsDiscoveryCanonicalTracker {
  return { seenKeys: new Set(), collisions: 0, uniqueSupportedKeys: 0 };
}

export function canonicalKeyForCandidate(
  type: AtsType,
  slug: string,
): string {
  return `${type}\0${slug}`;
}

/**
 * Record canonical key; returns true if this key was already seen in the sync.
 */
export function trackCanonicalCandidate(
  tracker: OpenClawAtsDiscoveryCanonicalTracker,
  result: OpenClawAtsDiscoveryEvalResult,
): boolean {
  const o = result.outcome;
  if (o.status === "rejected" || !result.detectedType) return false;
  const slug = o.candidate.slug;
  const key = canonicalKeyForCandidate(result.detectedType, slug);
  if (tracker.seenKeys.has(key)) {
    tracker.collisions += 1;
    return true;
  }
  tracker.seenKeys.add(key);
  tracker.uniqueSupportedKeys += 1;
  return false;
}

function looksLikeLocale(segment: string): boolean {
  return /^[a-z]{2}(-[a-z]{2})?$/i.test(segment);
}

function isPlausibleBoardSite(site: string): boolean {
  const s = site.trim();
  if (s.length < 2 || s.length > 120) return false;
  if (s.toLowerCase() === "job") return false;
  if (UUID_RE.test(s)) return false;
  return true;
}

/**
 * Board-level Workday extraction: site = path segment immediately before `/job/`,
 * never the terminal job-title segment.
 */
export function parseOpenClawWorkdayBoard(normalizedUrl: string): WorkdayTokenParts | null {
  try {
    const url = new URL(normalizedUrl);
    const host = url.hostname.toLowerCase();
    if (!host.includes("myworkdayjobs.com")) return null;
    const tenant = host.split(".")[0]!;
    if (!tenant) return null;

    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts.length === 0) return null;

    const jobIdx = pathParts.findIndex((p) => p.toLowerCase() === "job");
    if (jobIdx > 0) {
      const site = pathParts[jobIdx - 1]!;
      if (isPlausibleBoardSite(site) && !looksLikeLocale(site)) {
        return { host, tenant, site };
      }
      if (jobIdx >= 2) {
        const boardCandidate = pathParts[jobIdx - 1]!;
        if (isPlausibleBoardSite(boardCandidate)) {
          return { host, tenant, site: boardCandidate };
        }
      }
    }

    if (jobIdx === 0 && pathParts.length >= 2) {
      return { host, tenant, site: "Careers" };
    }

    if (pathParts.length >= 1) {
      const site = pathParts[0]!;
      if (isPlausibleBoardSite(site) && !looksLikeLocale(site)) {
        return { host, tenant, site };
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function openClawWorkdayBoardUrl(parts: WorkdayTokenParts): string {
  return `https://${parts.host}`;
}

function isPlausibleCompanySlug(slug: string): boolean {
  const s = slug.trim();
  if (s.length < 2 || s.length > 80) return false;
  if (UUID_RE.test(s)) return false;
  if (/^j$/i.test(s)) return false;
  return /^[a-z0-9][a-z0-9._-]*$/i.test(s);
}

/**
 * OpenClaw-specific slug extraction with listing URL support for ashby/lever/workable.
 */
export function extractOpenClawDiscoverySlug(
  url: string,
  type: AtsType,
): string | null {
  const normalized = normalizeAtsUrl(url);
  if (!normalized) return null;

  if (type === "workday") {
    const board = parseOpenClawWorkdayBoard(normalized);
    if (!board) return null;
    return buildWorkdaySlug(board);
  }

  let u: URL;
  try {
    u = new URL(normalized);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);

  if (type === "ashby" && host.includes("ashbyhq.com")) {
    if (host === "jobs.ashbyhq.com" || host.endsWith(".jobs.ashbyhq.com")) {
      const company = parts[0];
      if (company && isPlausibleCompanySlug(company)) return asciiSafeLower(company);
    }
    return extractSlug(normalized, type);
  }

  if (type === "lever" && host.includes("lever.co")) {
    if (host === "jobs.lever.co") {
      const company = parts[0];
      if (company && isPlausibleCompanySlug(company)) return asciiSafeLower(company);
    }
    return extractSlug(normalized, type);
  }

  if (type === "workable" && host.includes("workable.com")) {
    if (host === "apply.workable.com" && parts[0] && parts[1]?.toLowerCase() === "j") {
      const company = parts[0];
      if (isPlausibleCompanySlug(company)) return asciiSafeLower(company);
    }
    return extractSlug(normalized, type);
  }

  return extractSlug(normalized, type);
}

function buildOpenClawCandidate(
  type: AtsType,
  slug: string,
  sourceUrl: string,
): AtsEndpointParseResult | null {
  if (type === "workday") {
    const normalized = normalizeAtsUrl(sourceUrl);
    if (!normalized) return null;
    const board = parseOpenClawWorkdayBoard(normalized);
    if (!board) return null;
    const workdaySlug = buildWorkdaySlug(board);
    return {
      type: "workday",
      slug: workdaySlug,
      baseUrl: `https://${board.host}/wday/cxs/${board.tenant}/${board.site}/jobs`,
      crawlToken: JSON.stringify(board),
    };
  }

  const baseUrl = buildBaseUrl(type, slug);
  if (!baseUrl) return null;
  return {
    type,
    slug,
    baseUrl,
    crawlToken: slug,
  };
}

/**
 * Infer ATS endpoint candidate from a sourceUrl. Pure logic — no DB, no Redis, no I/O.
 */
export function inferAtsCandidate(
  sourceUrl: string,
):
  | { status: "supported"; candidate: AtsEndpointParseResult; canonicalBoardUrl?: string }
  | { status: "rejected"; reason: OpenClawAtsDiscoveryRejectReason } {
  if (!sourceUrl?.trim()) {
    return { status: "rejected", reason: "invalid_url" };
  }

  try {
    const parsedUrl = new URL(sourceUrl.trim());
    if (!parsedUrl.hostname) {
      return { status: "rejected", reason: "unknown_host" };
    }
  } catch {
    return { status: "rejected", reason: "invalid_url" };
  }

  const detectedType = detectAtsTypeFromUrl(sourceUrl);
  if (!detectedType) {
    return { status: "rejected", reason: "unknown_host" };
  }

  if (!OPENCLAW_DISCOVERY_ALLOWLIST.has(detectedType)) {
    return { status: "rejected", reason: "unsupported_ats" };
  }

  const slug = extractOpenClawDiscoverySlug(sourceUrl, detectedType);
  if (!slug) {
    return { status: "rejected", reason: "slug_extraction_failed" };
  }

  if (slug.length < 2 || slug.length > 200) {
    return { status: "rejected", reason: "ambiguous_endpoint" };
  }

  const candidate = buildOpenClawCandidate(detectedType, slug, sourceUrl);
  if (!candidate) {
    return { status: "rejected", reason: "empty_base_url" };
  }

  let canonicalBoardUrl: string | undefined;
  if (detectedType === "workday") {
    const normalized = normalizeAtsUrl(sourceUrl);
    const board = normalized ? parseOpenClawWorkdayBoard(normalized) : null;
    if (board) canonicalBoardUrl = openClawWorkdayBoardUrl(board);
  } else if (candidate.baseUrl) {
    canonicalBoardUrl = candidate.baseUrl;
  }

  return { status: "supported", candidate, canonicalBoardUrl };
}

export type OpenClawAtsDiscoverySummary = {
  evaluated: number;
  supported: number;
  rejected: number;
  would_create: number;
  existing_endpoint: number;
  reject_breakdown: Partial<Record<OpenClawAtsDiscoveryRejectReason, number>>;
  ats_breakdown: Record<string, { would_create: number; existing: number }>;
  unique_canonical_candidates: number;
  canonicalization_collisions: number;
  persist_created: number;
  persist_updated_seen: number;
  persist_skipped: number;
  inventory_total: number;
  inventory_stale_not_seen_days: number;
  inventory_sweep_stale?: number;
  inventory_activation_tiers?: Record<string, number>;
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
    unique_canonical_candidates: 0,
    canonicalization_collisions: 0,
    persist_created: 0,
    persist_updated_seen: 0,
    persist_skipped: 0,
    inventory_total: 0,
    inventory_stale_not_seen_days: 0,
  };
}

export function finalizeAtsDiscoverySummary(
  summary: OpenClawAtsDiscoverySummary,
  tracker: OpenClawAtsDiscoveryCanonicalTracker,
): void {
  summary.unique_canonical_candidates = tracker.uniqueSupportedKeys;
  summary.canonicalization_collisions = tracker.collisions;
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
