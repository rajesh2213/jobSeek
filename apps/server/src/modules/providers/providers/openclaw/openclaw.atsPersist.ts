/**
 * OpenClaw discovery → inactive AtsEndpoint persistence (discovery inventory only).
 * Never activates endpoints, never enqueues crawls or parser jobs.
 */

import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { AtsEndpointParseResult } from "../../../atsDiscovery/atsUrlParser.js";
import { parseWorkdaySlug } from "../../../atsDiscovery/atsUrlParser.js";
import { logger } from "../../../../utils/logger.js";
import {
  buildDiscoveryMetadata,
  computeDiscoveryConfidence,
  isSuspiciousDiscoverySlug,
  mergeDiscoveryMetadataOnSeen,
  openClawMinPersistConfidence,
  parseOpenClawDiscoveryIntel,
} from "./openclaw.discoveryQuality.js";

export type OpenClawPersistSkipReason =
  | "collision_in_sync"
  | "existing_endpoint"
  | "existing_workday_board"
  | "low_confidence"
  | "suspicious_slug"
  | "dry_run";

export type OpenClawPersistResult =
  | { status: "created"; endpointId: string }
  | { status: "skipped"; reason: OpenClawPersistSkipReason }
  | { status: "updated_seen"; endpointId: string };

export type OpenClawRediscoveryTouchSkipReason =
  | "not_found"
  | "not_openclaw_inventory"
  | "active_endpoint"
  | "dry_run"
  | "suspicious_slug";

export type OpenClawRediscoveryTouchResult =
  | { status: "updated_seen"; endpointId: string }
  | { status: "skipped"; reason: OpenClawRediscoveryTouchSkipReason };

async function applyOpenClawDiscoverySeenUpdate(
  prisma: PrismaClient,
  existing: {
    id: string;
    isActive: boolean;
    source: string | null;
    companyId: string | null;
    metadata: unknown;
  },
  input: {
    candidate: AtsEndpointParseResult;
    companyId: string;
    sourceUrl: string;
    canonicalCollision: boolean;
  },
): Promise<{ endpointId: string; intel: ReturnType<typeof parseOpenClawDiscoveryIntel> }> {
  const { candidate, companyId, sourceUrl, canonicalCollision } = input;
  const quality = computeDiscoveryConfidence({
    candidate,
    canonicalCollision,
    sourceUrl,
  });
  const now = new Date();
  const meta = mergeDiscoveryMetadataOnSeen(
    existing.metadata,
    candidate,
    quality,
    { canonicalCollision },
  ) as unknown as Prisma.InputJsonValue;
  await prisma.atsEndpoint.update({
    where: { id: existing.id },
    data: {
      lastSeenAt: now,
      metadata: meta,
      ...(companyId && !existing.companyId ? { companyId } : {}),
    },
  });
  const intel = parseOpenClawDiscoveryIntel(meta);
  logger.info(
    {
      event: "openclaw_ats_endpoint_rediscovered",
      provider: "openclaw",
      endpointId: existing.id,
      type: candidate.type,
      slug: candidate.slug,
      discovery_seen_count: intel?.discoverySeenCount,
      activation_readiness_score: intel?.activationReadinessScore,
      activation_candidate_tier: intel?.activationCandidateTier,
      freshness_confidence: intel?.freshnessConfidence,
    },
    "openclaw_ats_endpoint_rediscovered",
  );
  return { endpointId: existing.id, intel };
}

/** Preloaded dedupe keys from DB (single query per sync). */
export type OpenClawEndpointDedupeCache = {
  typeSlugKeys: Set<string>;
  workdayBoardKeys: Set<string>;
};

export function buildEndpointDedupeCache(
  rows: { type: string; slug: string }[],
): OpenClawEndpointDedupeCache {
  const typeSlugKeys = new Set<string>();
  const workdayBoardKeys = new Set<string>();
  for (const r of rows) {
    typeSlugKeys.add(`${r.type}\0${r.slug}`);
    if (r.type === "workday") {
      const parts = parseWorkdaySlug(r.slug);
      if (parts) {
        workdayBoardKeys.add(
          `${parts.host.toLowerCase()}\0${parts.tenant}\0${parts.site}`,
        );
      }
    }
  }
  return { typeSlugKeys, workdayBoardKeys };
}

export function workdayBoardKeyFromCandidate(candidate: AtsEndpointParseResult): string | null {
  if (candidate.type !== "workday") return null;
  const parts = parseWorkdaySlug(candidate.slug);
  if (!parts) return null;
  return `${parts.host.toLowerCase()}\0${parts.tenant}\0${parts.site}`;
}

export function shouldSkipOpenClawPersist(input: {
  candidate: AtsEndpointParseResult;
  cache: OpenClawEndpointDedupeCache;
  canonicalCollision: boolean;
  dryRun: boolean;
  sourceUrl: string;
}): OpenClawPersistSkipReason | null {
  if (input.dryRun) return "dry_run";
  if (input.canonicalCollision) return "collision_in_sync";
  if (isSuspiciousDiscoverySlug(input.candidate.type, input.candidate.slug)) {
    return "suspicious_slug";
  }
  const quality = computeDiscoveryConfidence({
    candidate: input.candidate,
    canonicalCollision: input.canonicalCollision,
    sourceUrl: input.sourceUrl,
  });
  if (quality.confidence < openClawMinPersistConfidence()) {
    return "low_confidence";
  }
  const key = `${input.candidate.type}\0${input.candidate.slug}`;
  if (input.cache.typeSlugKeys.has(key)) return "existing_endpoint";
  if (input.candidate.type === "workday") {
    const boardKey = workdayBoardKeyFromCandidate(input.candidate);
    if (boardKey && input.cache.workdayBoardKeys.has(boardKey)) {
      return "existing_workday_board";
    }
  }
  return null;
}

export function evaluateDiscoveryQuality(
  candidate: AtsEndpointParseResult,
  input: { canonicalCollision: boolean; sourceUrl: string },
) {
  return computeDiscoveryConfidence({
    candidate,
    canonicalCollision: input.canonicalCollision,
    sourceUrl: input.sourceUrl,
  });
}

const OPENCLAW_DISCOVERY_SCORE = 3;

/**
 * Metadata-only bump when shadow eval hits an existing board (dedupe cache).
 * Only touches inactive `source=openclaw` rows — never activates or enqueues crawls.
 */
export async function touchInactiveOpenClawEndpointOnRediscovery(
  prisma: PrismaClient,
  input: {
    candidate: AtsEndpointParseResult;
    companyId: string;
    sourceUrl: string;
    canonicalCollision: boolean;
    dryRun: boolean;
  },
): Promise<OpenClawRediscoveryTouchResult> {
  const { candidate, companyId, sourceUrl, canonicalCollision, dryRun } = input;
  if (dryRun) return { status: "skipped", reason: "dry_run" };
  if (isSuspiciousDiscoverySlug(candidate.type, candidate.slug)) {
    return { status: "skipped", reason: "suspicious_slug" };
  }

  const existing = await prisma.atsEndpoint.findUnique({
    where: { type_slug: { type: candidate.type, slug: candidate.slug } },
    select: { id: true, isActive: true, source: true, companyId: true, metadata: true },
  });
  if (!existing) return { status: "skipped", reason: "not_found" };
  if (existing.source !== "openclaw") {
    return { status: "skipped", reason: "not_openclaw_inventory" };
  }
  if (existing.isActive) return { status: "skipped", reason: "active_endpoint" };

  const { endpointId } = await applyOpenClawDiscoverySeenUpdate(prisma, existing, {
    candidate,
    companyId,
    sourceUrl,
    canonicalCollision,
  });
  return { status: "updated_seen", endpointId };
}

/**
 * Upsert inactive discovery endpoint. Does not enable crawling or parsing.
 */
export async function persistInactiveOpenClawEndpoint(
  prisma: PrismaClient,
  input: {
    candidate: AtsEndpointParseResult;
    companyId: string;
    companyName?: string | null;
    cache: OpenClawEndpointDedupeCache;
    sourceUrl: string;
    canonicalCollision: boolean;
  },
): Promise<OpenClawPersistResult> {
  const { candidate, companyId, companyName, cache, sourceUrl, canonicalCollision } = input;
  const typeSlugKey = `${candidate.type}\0${candidate.slug}`;

  const quality = computeDiscoveryConfidence({
    candidate,
    canonicalCollision,
    sourceUrl,
  });
  const now = new Date();

  try {
    const existing = await prisma.atsEndpoint.findUnique({
      where: { type_slug: { type: candidate.type, slug: candidate.slug } },
      select: { id: true, isActive: true, source: true, companyId: true, metadata: true },
    });

    if (existing) {
      await applyOpenClawDiscoverySeenUpdate(prisma, existing, {
        candidate,
        companyId,
        sourceUrl,
        canonicalCollision,
      });
      cache.typeSlugKeys.add(typeSlugKey);
      const boardKey = workdayBoardKeyFromCandidate(candidate);
      if (boardKey) cache.workdayBoardKeys.add(boardKey);
      return { status: "updated_seen", endpointId: existing.id };
    }

    const discoveryMeta = buildDiscoveryMetadata(candidate, quality, {
      canonicalCollision,
    });
    const meta = discoveryMeta as unknown as Prisma.InputJsonValue;

    const row = await prisma.atsEndpoint.create({
      data: {
        type: candidate.type,
        slug: candidate.slug,
        baseUrl: candidate.baseUrl,
        metadata: meta,
        isActive: false,
        score: OPENCLAW_DISCOVERY_SCORE,
        source: "openclaw",
        companyId,
        companyName: companyName?.trim() || null,
        lastSeenAt: now,
      },
    });

    cache.typeSlugKeys.add(typeSlugKey);
    const boardKey = workdayBoardKeyFromCandidate(candidate);
    if (boardKey) cache.workdayBoardKeys.add(boardKey);

    logger.info(
      {
        event: "openclaw_ats_endpoint_persisted",
        provider: "openclaw",
        endpointId: row.id,
        type: row.type,
        slug: row.slug,
        isActive: false,
        source: "openclaw",
        discovery_confidence: quality.confidence,
        activation_candidate_score: quality.activationCandidateScore,
        activation_readiness_score: discoveryMeta.openclawDiscovery.activationReadinessScore,
        activation_candidate_tier: discoveryMeta.openclawDiscovery.activationCandidateTier,
        discovery_seen_count: discoveryMeta.openclawDiscovery.discoverySeenCount,
      },
      "openclaw_ats_endpoint_persisted",
    );

    return { status: "created", endpointId: row.id };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return { status: "skipped", reason: "existing_endpoint" };
    }
    throw err;
  }
}
