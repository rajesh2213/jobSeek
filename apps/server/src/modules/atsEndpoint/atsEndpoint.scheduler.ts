import { loadRootEnv } from "../../infrastructure/env/loadEnv.js";
import { prisma } from "../../infrastructure/db/prisma.js";
import { logger } from "../../utils/logger.js";
import { assertWorkerProcessEnv } from "../../infrastructure/env/validateWorkerEnv.js";
import { registerSchedulerShutdown } from "../../utils/schedulerShutdown.js";
import {
  getIngestAtsEndpointQueue,
  closeIngestAtsEndpointQueue,
  INGEST_ATS_ENDPOINT_JOB,
  INGEST_ATS_ENDPOINT_QUEUE_NAME,
} from "../../queues/ats-endpoint.queue.js";
import { getEndpointPriority } from "./atsEndpointPriority.js";
import { assertRequiredSelect, logQueryMetrics } from "../../utils/queryMetrics.js";

/**
 * TODO(provider-isolation): Today all crawlable endpoints share one Bull queue (`ingest-ats-endpoint`)
 * and one worker concurrency budget. A long Workday ingest can starve other providers.
 * Set `ATS_ENDPOINT_SCHEDULER_MAX_PER_TYPE` (1–50, default **0** = off) to cap each `type` in the
 * first pass of a batch, then fill remaining slots by global priority — reduces Workday monopolization.
 */
const MIN_INTERVAL_MS = 5 * 60 * 1000;
const MAX_INTERVAL_MS = 8 * 60 * 1000;

const DEFAULT_POOL_LIMIT = 100;
const DEFAULT_BATCH_SIZE = 40;
const MIN_BATCH_SIZE = 20;
const MAX_BATCH_SIZE = 100;
// REQUIRED_SELECT
const ATS_ENDPOINT_SCHED_SELECT = {
  id: true,
  type: true,
  score: true,
  successCount: true,
  lastCrawledAt: true,
} as const;

function endpointCooldownMs(score: number): number {
  if (score >= 80) return 5 * 60 * 1000;
  if (score >= 40) return 30 * 60 * 1000;
  return 2 * 60 * 60 * 1000;
}

function randomIntInclusive(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

type SchedEp = {
  id: string;
  type: string;
  score: number;
  successCount: number;
  lastCrawledAt: Date | null;
};

/**
 * Starvation guard: first pass respects global priority order but caps each `type`
 * at `maxPerType`. Second pass fills up to `maxTotal` with remaining rows (preserves
 * global priority order) **without** per-type caps so low-volume providers cannot be
 * permanently starved when the pool is larger than `maxTotal`. Set
 * `ATS_ENDPOINT_SCHEDULER_MAX_PER_TYPE=0` to disable fairness slicing.
 */
function fairBatchSlice(
  sorted: SchedEp[],
  maxTotal: number,
  maxPerType: number,
): { batch: SchedEp[]; skippedFirstPassByType: Record<string, number> } {
  if (maxPerType <= 0 || sorted.length === 0) {
    return { batch: sorted.slice(0, maxTotal), skippedFirstPassByType: {} };
  }
  const perType = new Map<string, number>();
  const skippedFirstPassByType: Record<string, number> = {};
  const out: SchedEp[] = [];
  for (const row of sorted) {
    if (out.length >= maxTotal) break;
    const c = perType.get(row.type) ?? 0;
    if (c >= maxPerType) {
      skippedFirstPassByType[row.type] = (skippedFirstPassByType[row.type] ?? 0) + 1;
      continue;
    }
    perType.set(row.type, c + 1);
    out.push(row);
  }
  if (out.length < maxTotal) {
    for (const row of sorted) {
      if (out.length >= maxTotal) break;
      if (out.some((o) => o.id === row.id)) continue;
      out.push(row);
    }
  }
  return { batch: out, skippedFirstPassByType };
}

async function enqueuePrioritizedIngests(): Promise<void> {
  const queue = getIngestAtsEndpointQueue();
  const now = new Date();
  const nowMs = now.getTime();
  const poolLimit = Math.max(10, Math.min(100, Number(process.env.ATS_ENDPOINT_POOL_LIMIT ?? String(DEFAULT_POOL_LIMIT)) || DEFAULT_POOL_LIMIT));
  const baseBatchSize = Math.max(MIN_BATCH_SIZE, Math.min(MAX_BATCH_SIZE, Number(process.env.ATS_ENDPOINT_BATCH_SIZE ?? String(DEFAULT_BATCH_SIZE)) || DEFAULT_BATCH_SIZE));
  assertRequiredSelect("AtsEndpoint", "atsEndpoint.scheduler.findMany", ATS_ENDPOINT_SCHED_SELECT);

  const pool = await prisma.atsEndpoint.findMany({
    where: {
      isActive: true,
      OR: [
        { score: { gte: 80 }, OR: [{ lastCrawledAt: null }, { lastCrawledAt: { lt: new Date(nowMs - endpointCooldownMs(80)) } }] },
        { score: { gte: 40, lt: 80 }, OR: [{ lastCrawledAt: null }, { lastCrawledAt: { lt: new Date(nowMs - endpointCooldownMs(40)) } }] },
        { score: { lt: 40 }, OR: [{ lastCrawledAt: null }, { lastCrawledAt: { lt: new Date(nowMs - endpointCooldownMs(0)) } }] },
      ],
    },
    select: ATS_ENDPOINT_SCHED_SELECT,
    orderBy: [{ score: "desc" }, { successCount: "desc" }, { lastCrawledAt: "asc" }],
    take: poolLimit,
  });
  const queryMetrics = logQueryMetrics("atsEndpoint.scheduler.findMany", pool, 256, {
    countTowardEgress: false,
  });

  pool.sort((a, b) => {
    const d = getEndpointPriority(b) - getEndpointPriority(a);
    if (d !== 0) return d;
    return a.id.localeCompare(b.id);
  });
  let adaptiveBatchSize = baseBatchSize;
  if (queryMetrics.estimatedKB > 500) adaptiveBatchSize = Math.max(MIN_BATCH_SIZE, Math.floor(baseBatchSize / 2));
  else if (queryMetrics.estimatedKB < 100) adaptiveBatchSize = Math.min(MAX_BATCH_SIZE, baseBatchSize + 20);
  const maxPerTypeRaw = Number(process.env.ATS_ENDPOINT_SCHEDULER_MAX_PER_TYPE ?? "0");
  const maxPerType = Number.isFinite(maxPerTypeRaw)
    ? Math.max(0, Math.min(50, Math.floor(maxPerTypeRaw)))
    : 12;
  const fair = fairBatchSlice(pool as SchedEp[], adaptiveBatchSize, maxPerType);
  const top = fair.batch;

  if (maxPerType > 0 && top.length > 0) {
    const byType: Record<string, number> = {};
    for (const row of top) {
      byType[row.type] = (byType[row.type] ?? 0) + 1;
    }
    const skippedTypes = Object.entries(fair.skippedFirstPassByType).filter(([, n]) => n > 0);
    logger.info(
      {
        event: "ats_endpoint_scheduler_fairness",
        maxPerType,
        enqueued: top.length,
        poolSize: pool.length,
        enqueueByType: byType,
        skippedFirstPassTotal: skippedTypes.reduce((a, [, n]) => a + n, 0),
        skippedFirstPassByType: Object.fromEntries(skippedTypes),
      },
      "ats_endpoint_scheduler_fairness",
    );
  }

  for (let i = 0; i < top.length; i++) {
    const ep = top[i]!;
    await queue.add(
      INGEST_ATS_ENDPOINT_JOB,
      { endpointId: ep.id },
      {
        jobId: `sched-ingest-${ep.id}`,
      },
    );
  }

  logger.info(
    {
      event: "ats_endpoint_scheduler_run",
      queue: INGEST_ATS_ENDPOINT_QUEUE_NAME,
      poolSize: pool.length,
      eligibleCount: pool.length,
      enqueued: top.length,
      batchSize: adaptiveBatchSize,
      baseBatchSize,
      poolLimit,
      maxPerTypeFairness: maxPerType,
      estimatedKB: Number(queryMetrics.estimatedKB.toFixed(2)),
    },
    "ats_endpoint_scheduler_run",
  );
}

async function main(): Promise<void> {
  loadRootEnv();
  assertWorkerProcessEnv();
  void INGEST_ATS_ENDPOINT_QUEUE_NAME;

  logger.info({ event: "ats_endpoint_scheduler_started" }, "ats_endpoint_scheduler_started");

  try {
    await enqueuePrioritizedIngests();
  } catch (err) {
    logger.error({ event: "ats_endpoint_scheduler_run_failed", err }, "ats_endpoint_scheduler_run_failed");
  }

  const ms = randomIntInclusive(MIN_INTERVAL_MS, MAX_INTERVAL_MS);
  const interval = setInterval(() => {
    void enqueuePrioritizedIngests().catch((err) => {
      logger.error({ event: "ats_endpoint_scheduler_run_failed", err }, "ats_endpoint_scheduler_run_failed");
    });
  }, ms);

  registerSchedulerShutdown({
    intervalIds: [interval],
    closeQueues: [closeIngestAtsEndpointQueue],
    prismaDisconnect: () => prisma.$disconnect(),
  });
}

void main().catch((err) => {
  logger.error({ event: "ats_endpoint_scheduler_boot_failed", err }, "ats_endpoint_scheduler_boot_failed");
  process.exitCode = 1;
});
