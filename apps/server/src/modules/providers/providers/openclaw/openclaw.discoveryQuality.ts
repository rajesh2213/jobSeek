/**
 * OpenClaw ATS discovery + inventory intelligence — metadata only (no activation/crawl).
 */

import type { AtsType } from "../../../ats/ats.interface.js";
import { parseWorkdaySlug } from "../../../atsDiscovery/atsUrlParser.js";
import type { AtsEndpointParseResult } from "../../../atsDiscovery/atsUrlParser.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WORKDAY_SITE_JOB_LIKE = /_(jr|r\d{4,}|-\d{5,})/i;

export type ActivationCandidateTier =
  | "HIGH_CONFIDENCE"
  | "OBSERVE_LONGER"
  | "LOW_CONFIDENCE"
  | "NEVER_ACTIVATE";

export type OpenClawDiscoveryIntel = {
  discoveryConfidence: number;
  activationCandidateScore: number;
  candidateReason: string;
  discoveryFirstSeenAt: string;
  lastDiscoverySeenAt: string;
  discoverySeenCount: number;
  lastDiscoveryConfidence: number;
  repeatDiscoveryBoost: number;
  repeatDiscoveryStrength: number;
  freshnessConfidence: number;
  activationReadinessScore: number;
  activationCandidateTier: ActivationCandidateTier;
  inventoryAgeDays: number;
  staleCandidate: boolean;
  atsTrustScore: number;
  endpointStability: number;
  rediscoveryFrequency: number;
};

export type OpenClawDiscoveryMetadata = {
  crawlToken: string;
  openclawDiscovery: OpenClawDiscoveryIntel;
};

export function openClawMinPersistConfidence(): number {
  const n = Number(process.env.OPENCLAW_DISCOVERY_MIN_PERSIST_CONFIDENCE ?? "70") || 70;
  return Math.max(50, Math.min(95, Math.floor(n)));
}

export function openClawStaleInventoryDays(): number {
  const n = Number(process.env.OPENCLAW_INVENTORY_STALE_DAYS ?? "14") || 14;
  return Math.max(7, Math.min(90, Math.floor(n)));
}

export function isSuspiciousDiscoverySlug(type: AtsType, slug: string): boolean {
  const s = slug.trim();
  if (!s || s.length < 2) return true;
  if (UUID_RE.test(s)) return true;

  if (type === "workday") {
    const parts = parseWorkdaySlug(s);
    if (!parts) return true;
    const site = parts.site;
    if (WORKDAY_SITE_JOB_LIKE.test(site)) return true;
    if (site.length > 80 && (site.match(/-/g)?.length ?? 0) > 6) return true;
    return false;
  }

  if (
    type === "bamboohr" ||
    type === "greenhouse" ||
    type === "lever" ||
    type === "ashby" ||
    type === "workable"
  ) {
    if (s.length > 80) return true;
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(s)) return true;
    if (/^(jobs?|careers?|apply|www)$/i.test(s)) return true;
  }

  return false;
}

function atsTrustScoreForType(type: AtsType): number {
  switch (type) {
    case "workday":
      return 88;
    case "greenhouse":
    case "bamboohr":
      return 82;
    case "ashby":
    case "workable":
      return 78;
    case "lever":
      return 75;
    default:
      return 50;
  }
}

export function computeDiscoveryConfidence(input: {
  candidate: AtsEndpointParseResult;
  canonicalCollision: boolean;
  sourceUrl: string;
}): { confidence: number; activationCandidateScore: number; reason: string } {
  const { candidate, canonicalCollision, sourceUrl } = input;
  let confidence = 72;
  let activation = 55;
  const reasons: string[] = [];

  switch (candidate.type) {
    case "workday":
      confidence += 8;
      activation += 5;
      reasons.push("workday_board");
      break;
    case "greenhouse":
    case "bamboohr":
      confidence += 6;
      activation += 8;
      reasons.push("stable_listing");
      break;
    case "ashby":
    case "workable":
    case "lever":
      confidence += 4;
      activation += 4;
      reasons.push("listing_host");
      break;
    default:
      confidence -= 20;
      activation -= 20;
      reasons.push("unsupported_type");
  }

  if (canonicalCollision) {
    confidence -= 25;
    activation -= 30;
    reasons.push("sync_collision");
  }

  if (isSuspiciousDiscoverySlug(candidate.type, candidate.slug)) {
    confidence -= 40;
    activation -= 50;
    reasons.push("suspicious_slug");
  }

  try {
    const u = new URL(sourceUrl);
    if (!u.hostname) {
      confidence -= 15;
      reasons.push("bad_host");
    }
  } catch {
    confidence -= 20;
    reasons.push("bad_url");
  }

  if (!candidate.baseUrl?.startsWith("https://")) {
    confidence -= 15;
    reasons.push("bad_base_url");
  }

  confidence = Math.max(0, Math.min(100, confidence));
  activation = Math.max(0, Math.min(100, activation));

  return {
    confidence,
    activationCandidateScore: activation,
    reason: reasons.join(","),
  };
}

function daysBetween(isoStart: string, nowMs: number): number {
  const t = Date.parse(isoStart);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((nowMs - t) / (24 * 60 * 60 * 1000)));
}

function freshnessFromLastSeen(lastSeenIso: string, nowMs: number): number {
  const days = daysBetween(lastSeenIso, nowMs);
  if (days <= 1) return 95;
  if (days <= 3) return 88;
  if (days <= 7) return 78;
  if (days <= 14) return 62;
  if (days <= 30) return 45;
  return Math.max(10, 45 - (days - 30));
}

export function classifyActivationTier(input: {
  activationReadinessScore: number;
  discoverySeenCount: number;
  staleCandidate: boolean;
  suspicious: boolean;
}): ActivationCandidateTier {
  if (input.suspicious || input.activationReadinessScore < 40) {
    return "NEVER_ACTIVATE";
  }
  if (input.staleCandidate && input.discoverySeenCount < 2) {
    return "LOW_CONFIDENCE";
  }
  if (input.activationReadinessScore >= 78 && input.discoverySeenCount >= 2) {
    return "HIGH_CONFIDENCE";
  }
  if (input.activationReadinessScore >= 58) {
    return "OBSERVE_LONGER";
  }
  return "LOW_CONFIDENCE";
}

/**
 * Full inventory intelligence from observation + optional prior state.
 */
export function computeInventoryIntelligence(input: {
  candidate: AtsEndpointParseResult;
  quality: { confidence: number; activationCandidateScore: number; reason: string };
  nowMs?: number;
  prev?: Partial<OpenClawDiscoveryIntel> | null;
  canonicalCollision?: boolean;
}): OpenClawDiscoveryIntel {
  const nowMs = input.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const prev = input.prev;
  const seenCount = (prev?.discoverySeenCount ?? 0) + 1;
  const firstSeen = prev?.discoveryFirstSeenAt ?? nowIso;
  const repeatBoost = Math.min(20, Math.max(0, (seenCount - 1) * 6));
  const repeatStrength = Math.min(100, seenCount * 22 + repeatBoost);

  let discoveryConfidence = Math.max(
    prev?.discoveryConfidence ?? 0,
    input.quality.confidence,
  );
  if (seenCount > 1) {
    discoveryConfidence = Math.min(100, discoveryConfidence + repeatBoost);
  }
  if (input.canonicalCollision) {
    discoveryConfidence = Math.max(0, discoveryConfidence - 8);
  }

  const lastDiscoverySeenAt = nowIso;
  let freshnessConfidence = freshnessFromLastSeen(lastDiscoverySeenAt, nowMs);
  const inventoryAgeDays = daysBetween(firstSeen, nowMs);
  const staleCandidate = false;

  if (staleCandidate && seenCount < 2) {
    freshnessConfidence = Math.max(5, freshnessConfidence - 25);
    discoveryConfidence = Math.max(0, discoveryConfidence - 15);
  }

  const atsTrust = atsTrustScoreForType(input.candidate.type);
  const endpointStability = Math.min(
    100,
    Math.round(
      (seenCount >= 3 ? 35 : seenCount >= 2 ? 22 : 10) +
        (inventoryAgeDays >= 7 ? 15 : 0) +
        (discoveryConfidence * 0.35),
    ),
  );
  const rediscoveryFrequency =
    inventoryAgeDays > 0 ? Math.round((seenCount / inventoryAgeDays) * 100) / 100 : seenCount;

  const activationReadinessScore = Math.min(
    100,
    Math.max(
      0,
      Math.round(
        discoveryConfidence * 0.35 +
          freshnessConfidence * 0.25 +
          input.quality.activationCandidateScore * 0.2 +
          atsTrust * 0.12 +
          endpointStability * 0.08 +
          repeatStrength * 0.05 -
          (staleCandidate ? 12 : 0) -
          (input.canonicalCollision ? 10 : 0),
      ),
    ),
  );

  const suspicious = isSuspiciousDiscoverySlug(input.candidate.type, input.candidate.slug);
  const activationCandidateTier = classifyActivationTier({
    activationReadinessScore,
    discoverySeenCount: seenCount,
    staleCandidate,
    suspicious,
  });

  return {
    discoveryConfidence,
    activationCandidateScore: Math.max(
      prev?.activationCandidateScore ?? 0,
      input.quality.activationCandidateScore,
    ),
    candidateReason: input.quality.reason,
    discoveryFirstSeenAt: firstSeen,
    lastDiscoverySeenAt,
    discoverySeenCount: seenCount,
    lastDiscoveryConfidence: input.quality.confidence,
    repeatDiscoveryBoost: repeatBoost,
    repeatDiscoveryStrength: repeatStrength,
    freshnessConfidence,
    activationReadinessScore,
    activationCandidateTier,
    inventoryAgeDays,
    staleCandidate,
    atsTrustScore: atsTrust,
    endpointStability,
    rediscoveryFrequency,
  };
}

export function parseOpenClawDiscoveryIntel(metadata: unknown): Partial<OpenClawDiscoveryIntel> | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as OpenClawDiscoveryMetadata;
  if (!m.openclawDiscovery || typeof m.openclawDiscovery !== "object") return null;
  const d = m.openclawDiscovery;
  return {
    ...d,
    discoveryFirstSeenAt: d.discoveryFirstSeenAt ?? (d as { firstDiscoverySeenAt?: string }).firstDiscoverySeenAt,
  };
}

export function buildDiscoveryMetadata(
  candidate: AtsEndpointParseResult,
  quality: { confidence: number; activationCandidateScore: number; reason: string },
  options?: { canonicalCollision?: boolean },
): OpenClawDiscoveryMetadata {
  const intel = computeInventoryIntelligence({
    candidate,
    quality,
    prev: null,
    canonicalCollision: options?.canonicalCollision ?? false,
  });
  return {
    crawlToken: candidate.crawlToken,
    openclawDiscovery: intel,
  };
}

export function mergeDiscoveryMetadataOnSeen(
  existing: unknown,
  candidate: AtsEndpointParseResult,
  quality: { confidence: number; activationCandidateScore: number; reason: string },
  options?: { canonicalCollision?: boolean },
): OpenClawDiscoveryMetadata {
  const prev = parseOpenClawDiscoveryIntel(existing);
  const intel = computeInventoryIntelligence({
    candidate,
    quality,
    prev,
    canonicalCollision: options?.canonicalCollision ?? false,
  });
  return {
    crawlToken: candidate.crawlToken,
    openclawDiscovery: intel,
  };
}

/** Recompute intelligence for inventory aging / stale pass (no new observation). */
export function recomputeInventoryIntelligenceFromStored(
  candidate: AtsEndpointParseResult,
  metadata: unknown,
  nowMs = Date.now(),
): OpenClawDiscoveryMetadata | null {
  const prev = parseOpenClawDiscoveryIntel(metadata);
  if (!prev?.discoveryFirstSeenAt) return null;

  const quality = {
    confidence: prev.lastDiscoveryConfidence ?? prev.discoveryConfidence ?? 70,
    activationCandidateScore: prev.activationCandidateScore ?? 55,
    reason: prev.candidateReason ?? "inventory_sweep",
  };

  const lastSeen = prev.lastDiscoverySeenAt ?? prev.discoveryFirstSeenAt;
  const daysSinceSeen = daysBetween(lastSeen, nowMs);
  const staleDays = openClawStaleInventoryDays();
  const staleCandidate = daysSinceSeen >= staleDays;

  let freshnessConfidence = freshnessFromLastSeen(lastSeen, nowMs);
  let discoveryConfidence = prev.discoveryConfidence ?? quality.confidence;
  if (staleCandidate) {
    const decay = Math.min(30, Math.max(0, daysSinceSeen - staleDays + 1) * 3);
    freshnessConfidence = Math.max(5, freshnessConfidence - decay);
    discoveryConfidence = Math.max(0, discoveryConfidence - Math.floor(decay / 2));
  }

  const seenCount = prev.discoverySeenCount ?? 1;
  const firstSeen = prev.discoveryFirstSeenAt;
  const inventoryAgeDays = daysBetween(firstSeen, nowMs);
  const repeatBoost = prev.repeatDiscoveryBoost ?? 0;
  const repeatStrength = prev.repeatDiscoveryStrength ?? Math.min(100, seenCount * 22);
  const atsTrust = prev.atsTrustScore ?? atsTrustScoreForType(candidate.type);
  const endpointStability = prev.endpointStability ?? 0;
  const rediscoveryFrequency =
    inventoryAgeDays > 0 ? Math.round((seenCount / inventoryAgeDays) * 100) / 100 : seenCount;

  const activationReadinessScore = Math.min(
    100,
    Math.max(
      0,
      Math.round(
        discoveryConfidence * 0.35 +
          freshnessConfidence * 0.25 +
          (prev.activationCandidateScore ?? 55) * 0.2 +
          atsTrust * 0.12 +
          endpointStability * 0.08 +
          repeatStrength * 0.05 -
          (staleCandidate ? 15 : 0),
      ),
    ),
  );

  const suspicious = isSuspiciousDiscoverySlug(candidate.type, candidate.slug);
  const activationCandidateTier = classifyActivationTier({
    activationReadinessScore,
    discoverySeenCount: seenCount,
    staleCandidate,
    suspicious,
  });

  return {
    crawlToken:
      (metadata as OpenClawDiscoveryMetadata)?.crawlToken ?? candidate.crawlToken,
    openclawDiscovery: {
      discoveryConfidence,
      activationCandidateScore: prev.activationCandidateScore ?? quality.activationCandidateScore,
      candidateReason: prev.candidateReason ?? quality.reason,
      discoveryFirstSeenAt: firstSeen,
      lastDiscoverySeenAt: lastSeen,
      discoverySeenCount: seenCount,
      lastDiscoveryConfidence: prev.lastDiscoveryConfidence ?? quality.confidence,
      repeatDiscoveryBoost: repeatBoost,
      repeatDiscoveryStrength: repeatStrength,
      freshnessConfidence,
      activationReadinessScore,
      activationCandidateTier,
      inventoryAgeDays,
      staleCandidate,
      atsTrustScore: atsTrust,
      endpointStability,
      rediscoveryFrequency,
    },
  };
}

export type InventoryIntelligenceSweepResult = {
  total: number;
  updated: number;
  stale: number;
  tiers: Record<ActivationCandidateTier, number>;
  byType: Record<string, number>;
};
