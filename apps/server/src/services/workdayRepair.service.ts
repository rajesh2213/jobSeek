import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { createJobRepository } from "../modules/job/job.repository.js";
import { parseWorkdayJob } from "../modules/ats/workday/workday.parser.js";
import {
  fetchWorkdayJobDetail,
  resolveWorkdayDetailContext,
} from "../modules/ats/workday/workday.detail.js";
import { isWorkdayPoisonedJob } from "../modules/ats/workday/workdayPoisoned.js";
import {
  recordWorkdayRepairCollisionMerged,
  recordWorkdayRepairFailed,
  recordWorkdayRepairSourceUrlCollision,
  recordWorkdayRepairSuccess,
} from "../modules/ats/workday/workdayDetailMetrics.js";
import { computeJobContentHash } from "../utils/jobContentHash.js";
import { computeJobQualityFlags } from "../services/qualityFlags.service.js";
import { recomputeCanonical } from "./jobCanonical.service.js";
import { invalidateJobDetailSeoCaches, invalidateSitemapSeoCaches } from "./jobSeoCacheInvalidation.service.js";
import type { Redis } from "ioredis";
import { logger } from "../utils/logger.js";
import type { WorkdayRawJob } from "../modules/ats/workday/workday.types.js";
import { withWorkdayJobRepairLock } from "../utils/workdayRepairLock.js";
import {
  workdayCursorWhere,
  type WorkdayRepairCursor,
} from "../utils/workdayRepairCursor.js";

export type WorkdayRepairResult =
  | { ok: true; jobId: string; wasPublishable: boolean; isPublishable: boolean }
  | { ok: false; jobId: string; reason: string };

export type WorkdayRepairOptions = {
  dryRun?: boolean;
  redis?: Redis | null;
  /** Skip per-job Redis lock (tests only). */
  skipJobLock?: boolean;
};

function deriveEffectivePostedAt(postedAt: Date | null, createdAt: Date): Date {
  return postedAt ?? createdAt;
}

type RepairSiblingRow = {
  id: string;
  canonicalJobId: string | null;
  isPublishable: boolean | null;
};

function resolveCanonicalTargetId(sibling: RepairSiblingRow): string {
  return sibling.canonicalJobId ?? sibling.id;
}

/**
 * Target sourceUrl already exists — merge detail into the canonical row and link poisoned stub as duplicate.
 */
async function absorbPoisonedWorkdayIntoSibling(
  prisma: PrismaClient,
  poisonedJobId: string,
  sibling: RepairSiblingRow,
  normalized: {
    sourceUrl: string;
    title: string;
    description: string;
    applyUrl?: string;
    postedAt?: Date;
  },
  options: WorkdayRepairOptions,
): Promise<WorkdayRepairResult> {
  const canonicalId = resolveCanonicalTargetId(sibling);
  const wasPublishable = sibling.isPublishable === true;

  await prisma.$transaction(async (tx) => {
    const repo = createJobRepository(tx as PrismaClient);
    await repo.mergeDescriptionIfRicher(canonicalId, normalized.description);
    if (normalized.postedAt) {
      await repo.mergePostedAtIfEarlier(canonicalId, normalized.postedAt);
    }
    await tx.job.update({
      where: { id: poisonedJobId },
      data: {
        canonicalJobId: canonicalId,
        requiresRepair: false,
        isPublishable: false,
        lastProcessedAt: new Date(),
      },
    });
    await recomputeCanonical(repo, canonicalId);
  });

  const canonicalAfter = await prisma.job.findUnique({
    where: { id: canonicalId },
    select: { isPublishable: true },
  });
  const isPublishable = canonicalAfter?.isPublishable === true;

  recordWorkdayRepairCollisionMerged();
  recordWorkdayRepairSuccess();
  logger.info(
    {
      event: "workday_repair_collision_merged",
      jobId: poisonedJobId,
      canonicalId,
      targetSourceUrl: normalized.sourceUrl,
      wasPublishable,
      isPublishable,
    },
    "workday_repair_collision_merged",
  );

  if (options.redis) {
    await invalidateJobDetailSeoCaches(options.redis, [canonicalId]);
    if (!wasPublishable && isPublishable) {
      await invalidateSitemapSeoCaches(options.redis);
    }
  }

  return {
    ok: true,
    jobId: poisonedJobId,
    wasPublishable,
    isPublishable,
  };
}

async function loadRepairContext(prisma: PrismaClient, jobId: string) {
  const row = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      source: true,
      sourceUrl: true,
      title: true,
      description: true,
      parsedDescription: true,
      companyId: true,
      canonicalJobId: true,
      isPublishable: true,
      createdAt: true,
      postedAt: true,
      company: { select: { atsBoardToken: true } },
    },
  });
  if (!row) return null;

  const endpoint = await prisma.atsEndpoint.findFirst({
    where: { companyId: row.companyId, type: "workday", isActive: true },
    select: { slug: true },
    orderBy: { lastSuccessAt: "desc" },
  });

  return { ...row, endpointSlug: endpoint?.slug ?? null };
}

async function repairWorkdayJobInner(
  prisma: PrismaClient,
  jobId: string,
  options: WorkdayRepairOptions,
): Promise<WorkdayRepairResult> {
  const ctx = await loadRepairContext(prisma, jobId);
  if (!ctx) return { ok: false, jobId, reason: "job_not_found" };
  if (ctx.canonicalJobId) return { ok: false, jobId, reason: "duplicate_row" };
  if (!isWorkdayPoisonedJob(ctx)) {
    return { ok: false, jobId, reason: "not_poisoned" };
  }

  const detailCtx = resolveWorkdayDetailContext(ctx.sourceUrl, {
    atsBoardToken: ctx.company.atsBoardToken,
    endpointSlug: ctx.endpointSlug,
  });
  if (!detailCtx) {
    recordWorkdayRepairFailed();
    return { ok: false, jobId, reason: "cannot_resolve_detail_context" };
  }

  const fetched = await fetchWorkdayJobDetail(detailCtx.token, detailCtx.externalPath);
  if (!fetched.ok) {
    recordWorkdayRepairFailed();
    logger.warn(
      {
        event: "workday_repair_failed",
        jobId,
        reason: fetched.reason,
        sourceUrl: ctx.sourceUrl,
      },
      "workday_repair_failed",
    );
    return { ok: false, jobId, reason: fetched.reason };
  }

  const raw: WorkdayRawJob = {
    token: detailCtx.token,
    job: { ...fetched.job, externalPath: detailCtx.externalPath },
    detailEnrichment: { outcome: "success" },
  };
  const normalized = parseWorkdayJob(raw, ctx.companyId);
  if (!normalized?.description?.trim()) {
    recordWorkdayRepairFailed();
    return { ok: false, jobId, reason: "parsed_empty_description" };
  }

  const flags = computeJobQualityFlags({
    source: "workday",
    sourceUrl: normalized.sourceUrl,
    description: normalized.description,
    parsedDescription: ctx.parsedDescription,
  });

  const contentHash = computeJobContentHash({
    title: normalized.title,
    description: normalized.description,
    applyUrl: normalized.applyUrl ?? normalized.sourceUrl,
  });

  const wasPublishable = ctx.isPublishable === true;
  const postedAt = normalized.postedAt ?? ctx.postedAt ?? null;
  const effectivePostedAt = deriveEffectivePostedAt(postedAt, ctx.createdAt);

  if (options.dryRun) {
    const existingSibling = await prisma.job.findUnique({
      where: { sourceUrl: normalized.sourceUrl },
      select: { id: true, canonicalJobId: true, isPublishable: true },
    });
    if (existingSibling && existingSibling.id !== jobId) {
      logger.info(
        {
          event: "workday_repair_dry_run_collision_merge",
          jobId,
          sourceUrl: ctx.sourceUrl,
          targetSourceUrl: normalized.sourceUrl,
          canonicalId: resolveCanonicalTargetId(existingSibling),
          descriptionLength: normalized.description.length,
        },
        "workday_repair_dry_run_collision_merge",
      );
      return {
        ok: true,
        jobId,
        wasPublishable: existingSibling.isPublishable === true,
        isPublishable: existingSibling.isPublishable === true,
      };
    }
    logger.info(
      {
        event: "workday_repair_dry_run",
        jobId,
        sourceUrl: ctx.sourceUrl,
        newSourceUrl: normalized.sourceUrl,
        descriptionLength: normalized.description.length,
        isPublishable: flags.isPublishable,
      },
      "workday_repair_dry_run",
    );
    return {
      ok: true,
      jobId,
      wasPublishable,
      isPublishable: flags.isPublishable === true,
    };
  }

  const existingSibling = await prisma.job.findUnique({
    where: { sourceUrl: normalized.sourceUrl },
    select: { id: true, canonicalJobId: true, isPublishable: true },
  });
  if (existingSibling && existingSibling.id !== jobId) {
    return absorbPoisonedWorkdayIntoSibling(
      prisma,
      jobId,
      existingSibling,
      {
        sourceUrl: normalized.sourceUrl,
        title: normalized.title,
        description: normalized.description,
        applyUrl: normalized.applyUrl,
        postedAt: normalized.postedAt,
      },
      options,
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.job.update({
        where: { id: jobId },
        data: {
          title: normalized.title,
          description: normalized.description,
          sourceUrl: normalized.sourceUrl,
          applyUrl: normalized.applyUrl ?? normalized.sourceUrl,
          postedAt,
          effectivePostedAt,
          contentHash,
          hasNonemptyDescription: flags.hasNonemptyDescription,
          hasUsableParsed: flags.hasUsableParsed,
          hasValidWorkdayUrlShape: flags.hasValidWorkdayUrlShape,
          isPublishable: flags.isPublishable,
          requiresRepair: flags.requiresRepair,
          lastProcessedAt: new Date(),
        },
      });
      const repo = createJobRepository(tx as PrismaClient);
      await recomputeCanonical(repo, jobId);
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const sibling = await prisma.job.findUnique({
        where: { sourceUrl: normalized.sourceUrl },
        select: { id: true, canonicalJobId: true, isPublishable: true },
      });
      if (sibling && sibling.id !== jobId) {
        return absorbPoisonedWorkdayIntoSibling(
          prisma,
          jobId,
          sibling,
          {
            sourceUrl: normalized.sourceUrl,
            title: normalized.title,
            description: normalized.description,
            applyUrl: normalized.applyUrl,
            postedAt: normalized.postedAt,
          },
          options,
        );
      }
      recordWorkdayRepairSourceUrlCollision();
      logger.warn(
        {
          event: "workday_repair_source_url_collision",
          jobId,
          from: ctx.sourceUrl,
          to: normalized.sourceUrl,
        },
        "workday_repair_source_url_collision",
      );
      return { ok: false, jobId, reason: "source_url_collision" };
    }
    throw err;
  }

  recordWorkdayRepairSuccess();
  logger.info(
    {
      event: "workday_repair_success",
      jobId,
      sourceUrl: normalized.sourceUrl,
      wasPublishable,
      isPublishable: flags.isPublishable,
    },
    "workday_repair_success",
  );

  if (options.redis) {
    await invalidateJobDetailSeoCaches(options.redis, [jobId]);
    if (!wasPublishable && flags.isPublishable) {
      await invalidateSitemapSeoCaches(options.redis);
    }
  }

  return {
    ok: true,
    jobId,
    wasPublishable,
    isPublishable: flags.isPublishable === true,
  };
}

/**
 * Repair one poisoned Workday job: fetch detail, restore description/URL/postedAt, recompute flags.
 * Idempotent — running twice on an already-repaired job is a no-op.
 */
export async function repairWorkdayJob(
  prisma: PrismaClient,
  jobId: string,
  options: WorkdayRepairOptions = {},
): Promise<WorkdayRepairResult> {
  if (options.skipJobLock || !options.redis) {
    return repairWorkdayJobInner(prisma, jobId, options);
  }

  const locked = await withWorkdayJobRepairLock(options.redis, jobId, () =>
    repairWorkdayJobInner(prisma, jobId, options),
  );
  if (locked && typeof locked === "object" && "locked" in locked) {
    return { ok: false, jobId, reason: "repair_in_progress" };
  }
  return locked as WorkdayRepairResult;
}

export type WorkdayPoisonedQuery = {
  companyId?: string;
  endpointId?: string;
  limit: number;
  afterCursor?: WorkdayRepairCursor | null;
};

/** Keyset-paginated repair candidates (deterministic createdAt + id ordering). */
export async function findPoisonedWorkdayJobs(
  prisma: PrismaClient,
  query: WorkdayPoisonedQuery,
): Promise<
  Array<{ id: string; sourceUrl: string; companyId: string; createdAt: Date }>
> {
  const companyFilter = query.companyId ? { companyId: query.companyId } : {};
  let endpointCompanyIds: string[] | undefined;
  if (query.endpointId) {
    const ep = await prisma.atsEndpoint.findUnique({
      where: { id: query.endpointId },
      select: { companyId: true },
    });
    if (!ep?.companyId) return [];
    endpointCompanyIds = [ep.companyId];
  }

  const cursorFilter = workdayCursorWhere(query.afterCursor ?? null);

  const rows = await prisma.job.findMany({
    where: {
      source: "workday",
      canonicalJobId: null,
      isActive: true,
      requiresRepair: true,
      ...(endpointCompanyIds ? { companyId: { in: endpointCompanyIds } } : companyFilter),
      ...cursorFilter,
    },
    select: {
      id: true,
      sourceUrl: true,
      companyId: true,
      source: true,
      description: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: query.limit,
  });

  return rows
    .filter((r) => isWorkdayPoisonedJob(r))
    .map((r) => ({
      id: r.id,
      sourceUrl: r.sourceUrl,
      companyId: r.companyId,
      createdAt: r.createdAt,
    }));
}
