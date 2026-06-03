import type { PrismaClient } from "@prisma/client";
import { logger } from "../../utils/logger.js";
import { applyOpenClawActiveScoreFloor } from "./openClawActiveScore.js";

export interface ScoreInput {
  id: string;
  type: string;
  slug: string;
  isActive: boolean;
  successCount: number;
  failureCount: number;
  score: number;
  lastCrawledAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  createdAt: Date;
  companyId: string | null;
}

export interface ScoreResult {
  score: number;
  reasons: string[];
}

const SCORE_MIN = 0;
const SCORE_MAX = 100;

/**
 * Deterministic, bounded endpoint score computation.
 * 
 * Bands:
 *   80+ = Hot (crawl every 15-30m)
 *   40-79 = Warm (crawl every 2-4h)
 *   <40 = Cold (crawl every 8-12h)
 */
export function computeEndpointScore(input: ScoreInput, recentJobCount?: number): ScoreResult {
  const reasons: string[] = [];
  let score = 0;

  // Base: active endpoints start higher
  if (input.isActive) {
    score += 20;
    reasons.push("+20 active");
  }

  // Success history: capped contribution from total successes
  const successBonus = Math.min(30, input.successCount * 2);
  if (successBonus > 0) {
    score += successBonus;
    reasons.push(`+${successBonus} success_history(${input.successCount})`);
  }

  // Recent success recency
  if (input.lastSuccessAt) {
    const hoursSinceSuccess = (Date.now() - input.lastSuccessAt.getTime()) / (3600 * 1000);
    if (hoursSinceSuccess < 6) {
      score += 15;
      reasons.push("+15 success<6h");
    } else if (hoursSinceSuccess < 24) {
      score += 10;
      reasons.push("+10 success<24h");
    } else if (hoursSinceSuccess < 72) {
      score += 5;
      reasons.push("+5 success<72h");
    }
  }

  // Job yield (if recent job count provided)
  if (recentJobCount != null) {
    if (recentJobCount >= 20) {
      score += 20;
      reasons.push(`+20 high_yield(${recentJobCount})`);
    } else if (recentJobCount >= 5) {
      score += 10;
      reasons.push(`+10 medium_yield(${recentJobCount})`);
    } else if (recentJobCount >= 1) {
      score += 5;
      reasons.push(`+5 low_yield(${recentJobCount})`);
    }
  }

  // Failure penalty
  if (input.failureCount > 0) {
    const penalty = Math.min(20, input.failureCount * 4);
    score -= penalty;
    reasons.push(`-${penalty} failures(${input.failureCount})`);
  }

  // Company linkage bonus
  if (input.companyId) {
    score += 5;
    reasons.push("+5 has_company");
  }

  // Clamp
  score = Math.max(SCORE_MIN, Math.min(SCORE_MAX, score));

  return { score, reasons };
}

/**
 * Recompute and persist endpoint score after a crawl event.
 * Safe: bounded query, single-row update, idempotent.
 */
export async function recomputeEndpointScore(
  prisma: PrismaClient,
  endpointId: string,
): Promise<{ oldScore: number; newScore: number; reasons: string[] } | null> {
  const endpoint = await prisma.atsEndpoint.findUnique({
    where: { id: endpointId },
    select: {
      id: true,
      type: true,
      slug: true,
      isActive: true,
      successCount: true,
      failureCount: true,
      score: true,
      lastCrawledAt: true,
      lastSuccessAt: true,
      lastFailureAt: true,
      createdAt: true,
      companyId: true,
      source: true,
    },
  });

  if (!endpoint) return null;

  let recentJobCount: number | undefined;
  if (endpoint.companyId) {
    const jobCount = await prisma.job.count({
      where: {
        companyId: endpoint.companyId,
        lastSeenAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) },
      },
    });
    recentJobCount = jobCount;
  }

  const { score: computedScore, reasons } = computeEndpointScore(endpoint, recentJobCount);
  const newScore = applyOpenClawActiveScoreFloor(
    computedScore,
    endpoint.source,
    endpoint.isActive,
  );
  const oldScore = endpoint.score;
  const scoreReasons =
    newScore > computedScore
      ? [...reasons, `+${newScore - computedScore} openclaw_active_floor`]
      : reasons;

  if (newScore !== oldScore) {
    await prisma.atsEndpoint.update({
      where: { id: endpointId },
      data: { score: newScore },
    });

    logger.info(
      {
        event: "endpoint_score_updated",
        endpointId,
        type: endpoint.type,
        slug: endpoint.slug,
        oldScore,
        newScore,
        reasons: scoreReasons,
      },
      "endpoint_score_updated",
    );
  }

  return { oldScore, newScore, reasons: scoreReasons };
}
