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

const MIN_INTERVAL_MS = 5 * 60 * 1000;
const MAX_INTERVAL_MS = 8 * 60 * 1000;

const POOL_LIMIT = 500;
const BATCH_SIZE = 50;
const MIN_CRAWL_GAP_MS = 2 * 60 * 1000;

function randomIntInclusive(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function enqueuePrioritizedIngests(): Promise<void> {
  const queue = getIngestAtsEndpointQueue();
  const now = Date.now();

  const pool = await prisma.atsEndpoint.findMany({
    where: { isActive: true },
    select: {
      id: true,
      score: true,
      successCount: true,
      lastCrawledAt: true,
    },
    take: POOL_LIMIT,
  });

  const eligible = pool.filter((ep) => {
    if (ep.lastCrawledAt == null) return true;
    return now - ep.lastCrawledAt.getTime() >= MIN_CRAWL_GAP_MS;
  });

  eligible.sort((a, b) => getEndpointPriority(b) - getEndpointPriority(a));

  const top = eligible.slice(0, BATCH_SIZE);

  for (let i = 0; i < top.length; i++) {
    const ep = top[i]!;
    await queue.add(
      INGEST_ATS_ENDPOINT_JOB,
      { endpointId: ep.id },
      {
        jobId: `sched-ingest-${ep.id}-${now}-${i}`,
      },
    );
  }

  logger.info(
    {
      event: "ats_endpoint_scheduler_run",
      queue: INGEST_ATS_ENDPOINT_QUEUE_NAME,
      poolSize: pool.length,
      eligibleCount: eligible.length,
      enqueued: top.length,
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
