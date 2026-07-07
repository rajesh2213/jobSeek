/**
 * Dedicated Workday poisoned-job repair worker.
 * Run: tsx src/workers/workdayRepair.worker.ts [--dry-run] [--max-jobs N] [--company-id UUID] [--endpoint-id UUID]
 */
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { getIoredis } from "../queues/job.queue.js";
import { delay } from "../utils/common.js";
import { logger } from "../utils/logger.js";
import {
  findPoisonedWorkdayJobs,
  repairWorkdayJob,
} from "../services/workdayRepair.service.js";
import {
  logWorkdayDetailMetricsSnapshot,
  setWorkdaySeoGaugeCounts,
} from "../modules/ats/workday/workdayDetailMetrics.js";
import { invalidateSitemapSeoCaches } from "../services/jobSeoCacheInvalidation.service.js";
import {
  decodeWorkdayRepairCursor,
  encodeWorkdayRepairCursor,
  type WorkdayRepairCursor,
} from "../utils/workdayRepairCursor.js";
import {
  acquireWorkdayRepairWorkerLock,
  releaseWorkdayRepairWorkerLock,
} from "../utils/workdayRepairLock.js";
import { isRetryableWorkdayRepairFailure } from "../modules/ats/workday/workdayDetailFailure.js";

const CHECKPOINT_KEY = "workday:repair:checkpoint";

type Args = {
  dryRun: boolean;
  maxJobs: number;
  batchSize: number;
  companyId?: string;
  endpointId?: string;
  throttleMs: number;
  resume: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    dryRun: false,
    maxJobs: 500,
    batchSize: 25,
    throttleMs: 400,
    resume: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") out.dryRun = true;
    if (arg === "--no-resume") out.resume = false;
    if (arg === "--max-jobs") out.maxJobs = Number(argv[i + 1] ?? out.maxJobs);
    if (arg === "--batch-size") out.batchSize = Number(argv[i + 1] ?? out.batchSize);
    if (arg === "--company-id") out.companyId = argv[i + 1];
    if (arg === "--endpoint-id") out.endpointId = argv[i + 1];
    if (arg === "--throttle-ms") out.throttleMs = Number(argv[i + 1] ?? out.throttleMs);
  }
  out.maxJobs = Math.max(1, Math.min(50_000, Math.floor(out.maxJobs)));
  out.batchSize = Math.max(1, Math.min(200, Math.floor(out.batchSize)));
  out.throttleMs = Math.max(100, Math.min(10_000, Math.floor(out.throttleMs)));
  return out;
}

async function loadCheckpoint(redis: ReturnType<typeof getIoredis>): Promise<WorkdayRepairCursor | null> {
  const v = await redis.get(CHECKPOINT_KEY);
  return decodeWorkdayRepairCursor(v ?? undefined);
}

async function saveCheckpoint(
  redis: ReturnType<typeof getIoredis>,
  cursor: WorkdayRepairCursor,
): Promise<void> {
  await redis.set(CHECKPOINT_KEY, encodeWorkdayRepairCursor(cursor), "EX", 7 * 24 * 3600);
}

async function clearCheckpoint(redis: ReturnType<typeof getIoredis>): Promise<void> {
  await redis.del(CHECKPOINT_KEY);
}

async function recordGaugeCounts(): Promise<void> {
  const [publishable, rootPath, emptyDesc] = await Promise.all([
    prisma.job.count({
      where: { canonicalJobId: null, isActive: true, isPublishable: true },
    }),
    prisma.job.count({
      where: {
        source: "workday",
        canonicalJobId: null,
        isActive: true,
        sourceUrl: { contains: "myworkdayjobs.com/job/", mode: "insensitive" },
      },
    }),
    prisma.job.count({
      where: {
        source: "workday",
        canonicalJobId: null,
        isActive: true,
        OR: [{ description: null }, { description: "" }],
      },
    }),
  ]);
  setWorkdaySeoGaugeCounts({
    publishableJobs: publishable,
    workdayRootPathJobs: rootPath,
    workdayEmptyDescriptionJobs: emptyDesc,
  });
}

async function main(): Promise<void> {
  loadRootEnv();
  const args = parseArgs(process.argv.slice(2));
  const redis = getIoredis();

  const lockOwner = `repair-${process.pid}`;
  const locked = await acquireWorkdayRepairWorkerLock(redis, lockOwner);
  if (!locked) {
    logger.error(
      { event: "workday_repair_worker_lock_denied" },
      "workday_repair_worker_lock_denied",
    );
    process.exit(1);
  }

  let afterCursor = args.resume ? await loadCheckpoint(redis) : null;
  let processed = 0;
  let repaired = 0;
  let failed = 0;
  let publishableDelta = 0;

  logger.info({ event: "workday_repair_worker_start", args }, "workday_repair_worker_start");

  try {
    while (processed < args.maxJobs) {
      const batch = await findPoisonedWorkdayJobs(prisma, {
        companyId: args.companyId,
        endpointId: args.endpointId,
        limit: Math.min(args.batchSize, args.maxJobs - processed),
        afterCursor,
      });
      if (batch.length === 0) {
        await clearCheckpoint(redis);
        break;
      }

      for (const row of batch) {
        const result = await repairWorkdayJob(prisma, row.id, {
          dryRun: args.dryRun,
          redis: args.dryRun ? null : redis,
        });
        processed += 1;

        if (result.ok) {
          repaired += 1;
          if (!result.wasPublishable && result.isPublishable) publishableDelta += 1;
          if (!args.dryRun) {
            await saveCheckpoint(redis, {
              createdAt: row.createdAt.toISOString(),
              id: row.id,
            });
            afterCursor = {
              createdAt: row.createdAt.toISOString(),
              id: row.id,
            };
          }
        } else if (result.reason !== "not_poisoned" && result.reason !== "repair_in_progress") {
          failed += 1;
          if (isRetryableWorkdayRepairFailure(result.reason)) {
            // Transient failure — stop batch so restart retries from last success.
            break;
          }
        }

        if (processed >= args.maxJobs) break;
        await delay(args.throttleMs);
      }
    }

    if (!args.dryRun && publishableDelta > 0) {
      await invalidateSitemapSeoCaches(redis);
    }

    await recordGaugeCounts();
    logWorkdayDetailMetricsSnapshot("workday_repair_worker_complete");

    logger.info(
      {
        event: "workday_repair_worker_complete",
        processed,
        repaired,
        failed,
        publishableDelta,
        dryRun: args.dryRun,
      },
      "workday_repair_worker_complete",
    );
  } finally {
    await releaseWorkdayRepairWorkerLock(redis);
    await prisma.$disconnect();
    await redis.quit();
  }
}

main().catch((err) => {
  logger.error({ event: "workday_repair_worker_fatal", err }, "workday_repair_worker_fatal");
  process.exit(1);
});
