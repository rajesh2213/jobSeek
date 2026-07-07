import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { computeJobQualityFlags } from "../services/qualityFlags.service.js";
import { selectBestDescription } from "../services/jobCanonical.service.js";
import { isWorkdayPoisonedJob } from "../modules/ats/workday/workdayPoisoned.js";
import { repairWorkdayJob } from "../services/workdayRepair.service.js";
import { recoverWorkdayPostedAtOnHashCacheHit } from "./workdayPostedAtHashHitRecovery.js";
import { recordHashCacheRepair } from "../modules/ats/workday/workdayDetailMetrics.js";
import { computeJobContentHash } from "./jobContentHash.js";
import {
  conditionalUpdateJobHashCacheHit,
  jobHashCacheConditionalUpdateEnabled,
} from "./jobWriteOptimization.js";
import { logger } from "./logger.js";

export type WorkdayHashCacheRecoveryInput = {
  sourceUrl: string;
  source: string;
  title: string;
  description?: string | null;
  applyUrl?: string | null;
  candidatePostedAt?: Date;
};

function shouldMergeIncomingDescription(
  existing: string | null | undefined,
  incoming: string | null | undefined,
): boolean {
  const inc = (incoming ?? "").trim();
  if (!inc) return false;
  const cur = (existing ?? "").trim();
  if (!cur) return true;
  return inc.length > cur.length;
}

export async function computePersistedContentHash(
  db: Pick<PrismaClient, "job">,
  sourceUrl: string,
  fallback: WorkdayHashCacheRecoveryInput,
): Promise<string> {
  const row = await db.job.findUnique({
    where: { sourceUrl },
    select: { title: true, description: true, applyUrl: true, sourceUrl: true },
  });
  if (!row) {
    return computeJobContentHash({
      title: fallback.title,
      description: fallback.description,
      applyUrl: fallback.applyUrl ?? fallback.sourceUrl,
    });
  }
  return computeJobContentHash({
    title: row.title,
    description: row.description,
    applyUrl: row.applyUrl ?? row.sourceUrl,
  });
}

/**
 * On ATS hash-cache hit, recover postedAt and merge description when DB row is empty.
 * For still-poisoned Workday rows, optional inline detail repair (off by default).
 */
export async function recoverWorkdayOnHashCacheHit(
  db: Pick<PrismaClient, "job">,
  input: WorkdayHashCacheRecoveryInput,
  redis?: Redis | null,
  options?: { attemptInlineRepair?: boolean },
): Promise<{ descriptionMerged: boolean; detailRepaired: boolean }> {
  let descriptionMerged = false;
  let detailRepaired = false;

  if (input.source !== "workday") {
    return { descriptionMerged, detailRepaired };
  }

  await recoverWorkdayPostedAtOnHashCacheHit(db, {
    sourceUrl: input.sourceUrl,
    source: input.source,
    candidate: input.candidatePostedAt,
  });

  const row = await db.job.findUnique({
    where: { sourceUrl: input.sourceUrl },
    select: {
      id: true,
      source: true,
      sourceUrl: true,
      title: true,
      description: true,
      applyUrl: true,
      canonicalJobId: true,
      parsedDescription: true,
    },
  });
  if (!row || row.canonicalJobId) {
    return { descriptionMerged, detailRepaired };
  }

  if (shouldMergeIncomingDescription(row.description, input.description)) {
    const merged = selectBestDescription(row.description, input.description ?? undefined);
    const flags = computeJobQualityFlags({
      source: row.source,
      sourceUrl: row.sourceUrl,
      description: merged,
      parsedDescription: row.parsedDescription,
    });
    const contentHash = computeJobContentHash({
      title: row.title,
      description: merged,
      applyUrl: row.applyUrl ?? row.sourceUrl,
    });
    await db.job.update({
      where: { id: row.id },
      data: {
        description: merged,
        contentHash,
        hasNonemptyDescription: flags.hasNonemptyDescription,
        hasUsableParsed: flags.hasUsableParsed,
        hasValidWorkdayUrlShape: flags.hasValidWorkdayUrlShape,
        isPublishable: flags.isPublishable,
        requiresRepair: flags.requiresRepair,
      },
    });
    descriptionMerged = true;
    recordHashCacheRepair();
    logger.info(
      {
        event: "hash_cache_description_recovered",
        jobId: row.id,
        sourceUrl: input.sourceUrl,
        contentHash,
      },
      "hash_cache_description_recovered",
    );
  }

  const fresh = await db.job.findUnique({
    where: { id: row.id },
    select: {
      id: true,
      source: true,
      sourceUrl: true,
      description: true,
    },
  });
  if (
    fresh &&
    isWorkdayPoisonedJob(fresh) &&
    options?.attemptInlineRepair === true
  ) {
    const result = await repairWorkdayJob(db as PrismaClient, fresh.id, { redis });
    if (result.ok) {
      detailRepaired = true;
      recordHashCacheRepair();
    }
  }

  return { descriptionMerged, detailRepaired };
}

export function shouldBypassHashCacheForDescriptionRecovery(
  existingDescription: string | null | undefined,
  incomingDescription: string | null | undefined,
): boolean {
  return shouldMergeIncomingDescription(existingDescription, incomingDescription);
}

export type HashCacheHitFinalizeInput = {
  hashCacheKey: string;
  hashCacheTtlSeconds: number;
  processedAt: Date;
  job: WorkdayHashCacheRecoveryInput;
  /** Explicit opt-in: WORKDAY_HASH_HIT_INLINE_REPAIR=true */
  inlineRepairEnabled: boolean;
};

/**
 * Run Workday recovery first, then persist hash for final DB content (never stale empty hash).
 */
export async function finalizeHashCacheHitAfterRecovery(
  prisma: PrismaClient,
  redis: Redis,
  input: HashCacheHitFinalizeInput,
): Promise<"skip_ingest" | "bypass_ingest"> {
  const existingRow = await prisma.job.findUnique({
    where: { sourceUrl: input.job.sourceUrl },
    select: { description: true },
  });
  if (
    shouldBypassHashCacheForDescriptionRecovery(
      existingRow?.description,
      input.job.description,
    )
  ) {
    return "bypass_ingest";
  }

  await recoverWorkdayOnHashCacheHit(prisma, input.job, redis, {
    attemptInlineRepair: input.inlineRepairEnabled,
  });

  const finalHash = await computePersistedContentHash(prisma, input.job.sourceUrl, input.job);
  await redis.set(input.hashCacheKey, finalHash, "EX", input.hashCacheTtlSeconds);
  if (jobHashCacheConditionalUpdateEnabled()) {
    await conditionalUpdateJobHashCacheHit(prisma, {
      sourceUrl: input.job.sourceUrl,
      contentHash: finalHash,
      processedAt: input.processedAt,
    });
  } else {
    await prisma.job.updateMany({
      where: { sourceUrl: input.job.sourceUrl },
      data: { lastProcessedAt: input.processedAt, contentHash: finalHash },
    });
  }
  return "skip_ingest";
}
