import {
  CompanyCrawlPriority,
  type CompanyScoreUpdatePayload,
  type IngestionFinishedUpdate,
  type PrismaClient,
} from "../prisma/generatedClient.js";
import { logger } from "../utils/logger.js";
import { getIoredis } from "../queues/job.queue.js";
import {
  getCompanyScoreQueue,
  SCORE_RECOMPUTE_JOB,
  type ScoreRecomputePayload,
} from "../queues/companyScore.queue.js";

const MS_48H = 48 * 60 * 60 * 1000;
const MS_3D = 3 * 24 * 60 * 60 * 1000;
const MS_7D = 7 * 24 * 60 * 60 * 1000;

const companySelectForScore = {
  atsType: true,
  lastIngestionSuccessAt: true,
  ingestionAttempts: true,
  lastAttemptAt: true,
} as const;

function scorePendingKey(companyId: string): string {
  return `score:pending:${companyId}`;
}

export interface CompanyScoreInput {
  atsType: string | null | undefined;
  hasActiveEndpoint: boolean;
  lastIngestionSuccessAt: Date | null;
  canonicalJobsLast7d: number;
  ingestionAttempts: number;
  lastAttemptAt: Date | null;
  now: Date;
}

/** 0–100+ raw score; persisted score is floored at 0. */
export function computeCompanyScore(input: CompanyScoreInput): number {
  const { atsType, hasActiveEndpoint, lastIngestionSuccessAt, canonicalJobsLast7d, now } = input;
  const { ingestionAttempts, lastAttemptAt } = input;

  let score = 0;
  if (atsType && String(atsType).trim() !== "") score += 40;
  if (hasActiveEndpoint) score += 30;

  if (lastIngestionSuccessAt) {
    const ageMs = now.getTime() - lastIngestionSuccessAt.getTime();
    if (ageMs >= 0 && ageMs <= MS_48H) {
      score += 20;
    }
    if (ageMs > MS_3D) {
      score -= 20;
    }
  } else {
    score -= 20;
  }

  if (canonicalJobsLast7d > 0) score += 10;
  if (canonicalJobsLast7d >= 5) score += 15;

  const lastAttemptIn7d =
    lastAttemptAt != null && now.getTime() - lastAttemptAt.getTime() <= MS_7D;
  if (canonicalJobsLast7d === 0 && ingestionAttempts > 5 && lastAttemptIn7d) {
    score -= 30;
  }

  return Math.max(0, score);
}

export function priorityFromScore(score: number): CompanyCrawlPriority {
  if (score >= 70) return CompanyCrawlPriority.high;
  if (score >= 40) return CompanyCrawlPriority.medium;
  return CompanyCrawlPriority.low;
}

export async function recomputeAndPersistCompanyScore(
  prisma: PrismaClient,
  companyId: string,
  now = new Date(),
): Promise<{ score: number; priority: CompanyCrawlPriority; canonicalJobsLast7d: number }> {
  const sevenDaysAgo = new Date(now.getTime() - MS_7D);

  const [hasActiveEndpoint, canonicalJobsLast7d, companyRow] = await Promise.all([
    prisma.atsEndpoint
      .count({ where: { companyId, isActive: true } })
      .then((c) => c > 0),
    prisma.job.count({
      where: {
        companyId,
        canonicalJobId: null,
        lastSeenAt: { gte: sevenDaysAgo },
      },
    }),
    prisma.company.findUnique({
      where: { id: companyId },
      select: companySelectForScore,
    }),
  ]);

  if (!companyRow) {
    throw new Error(`recomputeAndPersistCompanyScore: company not found ${companyId}`);
  }

  const score = computeCompanyScore({
    atsType: companyRow.atsType,
    hasActiveEndpoint,
    lastIngestionSuccessAt: companyRow.lastIngestionSuccessAt,
    canonicalJobsLast7d,
    ingestionAttempts: companyRow.ingestionAttempts,
    lastAttemptAt: companyRow.lastAttemptAt,
    now,
  });
  const priority = priorityFromScore(score);

  const data: CompanyScoreUpdatePayload = { score, priority, canonicalJobsLast7d };
  await prisma.company.update({
    where: { id: companyId },
    data,
  });

  logger.debug(
    { event: "company_score_updated", companyId, score, priority },
    "company score updated",
  );

  return { score, priority, canonicalJobsLast7d };
}

export async function logCompanyPriorityDistribution(prisma: PrismaClient): Promise<void> {
  const [high, medium, low] = await Promise.all([
    prisma.company.count({ where: { priority: CompanyCrawlPriority.high } as any }),
    prisma.company.count({ where: { priority: CompanyCrawlPriority.medium } as any }),
    prisma.company.count({ where: { priority: CompanyCrawlPriority.low } as any }),
  ]);
  const total = high + medium + low;
  logger.info(
    { event: "company_priority_distribution", high, medium, low, total },
    "company priority distribution",
  );
}

/** Bump ingestion counters, set success timestamp when applicable, then request score recompute. */
export async function recordIngestionFinished(
  prisma: PrismaClient,
  companyId: string,
  success: boolean,
): Promise<void> {
  const data: IngestionFinishedUpdate = {
    lastAttemptAt: new Date(),
    ingestionAttempts: { increment: 1 },
    ...(success ? { lastIngestionSuccessAt: new Date() } : {}),
  };
  await prisma.company.update({
    where: { id: companyId },
    data,
  });
  await requestScoreRecompute(companyId);
}

/** At most one score recompute per company per 60s (Redis SET NX + Bull). */
export async function requestScoreRecompute(companyId: string): Promise<void> {
  const redis = getIoredis();
  const key = scorePendingKey(companyId);
  const ok = await redis.set(key, "1", "EX", 60, "NX");
  if (ok !== "OK") return;

  const queue = getCompanyScoreQueue();
  const payload: ScoreRecomputePayload = { companyId };
  try {
    await queue.add(SCORE_RECOMPUTE_JOB, payload, {
      jobId: `score-recompute-${companyId}`,
    });
  } catch (err) {
    await redis.del(key);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("job") && msg.toLowerCase().includes("exists")) {
      return;
    }
    throw err;
  }
}
