/**
 * End-of-sync inventory intelligence sweep — metadata updates only.
 */

import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { logger } from "../../../../utils/logger.js";
import {
  recomputeInventoryIntelligenceFromStored,
  type ActivationCandidateTier,
  type InventoryIntelligenceSweepResult,
} from "./openclaw.discoveryQuality.js";
import type { AtsEndpointParseResult } from "../../../atsDiscovery/atsUrlParser.js";

function candidateFromRow(row: {
  type: string;
  slug: string;
  baseUrl: string;
  metadata: unknown;
}): AtsEndpointParseResult {
  const meta = row.metadata as { crawlToken?: string } | null;
  return {
    type: row.type as AtsEndpointParseResult["type"],
    slug: row.slug,
    baseUrl: row.baseUrl,
    crawlToken: meta?.crawlToken ?? row.slug,
  };
}

/**
 * Recompute stale/freshness/tier metadata for all inactive OpenClaw endpoints.
 * Does not activate, crawl, or delete.
 */
export async function runOpenClawInventoryIntelligenceSweep(
  prisma: PrismaClient,
): Promise<InventoryIntelligenceSweepResult> {
  const rows = await prisma.atsEndpoint.findMany({
    where: { source: "openclaw", isActive: false },
    select: {
      id: true,
      type: true,
      slug: true,
      baseUrl: true,
      metadata: true,
      createdAt: true,
      lastSeenAt: true,
    },
  });

  const tiers: Record<ActivationCandidateTier, number> = {
    HIGH_CONFIDENCE: 0,
    OBSERVE_LONGER: 0,
    LOW_CONFIDENCE: 0,
    NEVER_ACTIVATE: 0,
  };
  const byType: Record<string, number> = {};
  let updated = 0;
  let stale = 0;
  const nowMs = Date.now();

  for (const row of rows) {
    byType[row.type] = (byType[row.type] ?? 0) + 1;
    const candidate = candidateFromRow(row);
    let metaInput = row.metadata;
    const parsed = metaInput as { openclawDiscovery?: { discoveryFirstSeenAt?: string } } | null;
    if (!parsed?.openclawDiscovery?.discoveryFirstSeenAt) {
      const seedIso = (row.lastSeenAt ?? row.createdAt).toISOString();
      metaInput = {
        crawlToken: candidate.crawlToken,
        openclawDiscovery: {
          discoveryConfidence: 70,
          activationCandidateScore: 55,
          candidateReason: "legacy_backfill",
          discoveryFirstSeenAt: seedIso,
          lastDiscoverySeenAt: seedIso,
          discoverySeenCount: 1,
          lastDiscoveryConfidence: 70,
          repeatDiscoveryBoost: 0,
          repeatDiscoveryStrength: 22,
          freshnessConfidence: 85,
          activationReadinessScore: 65,
          activationCandidateTier: "OBSERVE_LONGER",
          inventoryAgeDays: 0,
          staleCandidate: false,
          atsTrustScore: 75,
          endpointStability: 10,
          rediscoveryFrequency: 1,
        },
      };
    }

    const nextMeta = recomputeInventoryIntelligenceFromStored(
      candidate,
      metaInput,
      nowMs,
    );
    if (!nextMeta) continue;

    const intel = nextMeta.openclawDiscovery;
    tiers[intel.activationCandidateTier] = (tiers[intel.activationCandidateTier] ?? 0) + 1;
    if (intel.staleCandidate) stale += 1;

    await prisma.atsEndpoint.update({
      where: { id: row.id },
      data: { metadata: nextMeta as unknown as Prisma.InputJsonValue },
    });
    updated += 1;
  }

  logger.info(
    {
      event: "openclaw_inventory_intelligence_sweep",
      provider: "openclaw",
      total: rows.length,
      updated,
      stale,
      tiers,
      by_type: byType,
    },
    "openclaw_inventory_intelligence_sweep",
  );

  return { total: rows.length, updated, stale, tiers, byType };
}
