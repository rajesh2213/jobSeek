import { Worker } from "bullmq";
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { logger } from "../utils/logger.js";
import { assertWorkerProcessEnv } from "../infrastructure/env/validateWorkerEnv.js";
import { registerWorkerShutdown } from "../utils/workerShutdown.js";
import { getRedisConnection } from "../queues/job.queue.js";
import {
  closeJobStatusReconcileQueue,
  JOB_STATUS_RECONCILE_QUEUE_NAME,
  JOB_STATUS_RECONCILE_TICK,
} from "../queues/jobStatusReconcile.queue.js";
import { recordStatusTransition } from "../services/jobStatusMetrics.service.js";

const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_MAX_BATCHES_PER_RUN = 20;

function numberEnv(name: string, fallback: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

const BATCH_SIZE = numberEnv("JOB_STATUS_RECONCILE_BATCH_SIZE", DEFAULT_BATCH_SIZE, 300);
const MAX_BATCHES_PER_RUN = numberEnv(
  "JOB_STATUS_RECONCILE_MAX_BATCHES_PER_RUN",
  DEFAULT_MAX_BATCHES_PER_RUN,
  100,
);

async function reconcileBatch(limit: number): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ id: string; previous_status: string | null }>>`
    WITH target AS (
      SELECT id, "status" AS previous_status
      FROM "Job"
      WHERE ("status" = 'processing' OR "status" IS NULL)
        AND "parsedDescription" IS NOT NULL
      ORDER BY "updatedAt" ASC
      LIMIT ${limit}
    )
    UPDATE "Job" AS j
    SET "status" = 'ready'
    FROM target
    WHERE j.id = target.id
    RETURNING j.id, target.previous_status
  `;
  for (const row of rows) {
    recordStatusTransition(row.previous_status, "ready", "reconcile_parsed_present");
  }
  return rows.length;
}

async function runReconcile(): Promise<{
  batches: number;
  reconciledToReady: number;
}> {
  let batches = 0;
  let reconciledToReady = 0;
  while (batches < MAX_BATCHES_PER_RUN) {
    const updated = await reconcileBatch(BATCH_SIZE);
    batches += 1;
    reconciledToReady += updated;
    if (updated === 0) break;
  }
  return { batches, reconciledToReady };
}

async function main(): Promise<void> {
  loadRootEnv();
  assertWorkerProcessEnv();

  logger.info(
    {
      event: "job_status_reconcile_worker_start",
      batchSize: BATCH_SIZE,
      maxBatchesPerRun: MAX_BATCHES_PER_RUN,
    },
    "job_status_reconcile_worker_start",
  );

  const worker = new Worker(
    JOB_STATUS_RECONCILE_QUEUE_NAME,
    async (job) => {
      if (job.name !== JOB_STATUS_RECONCILE_TICK) return;
      const out = await runReconcile();
      logger.info(
        {
          event: "job_status_reconcile_run",
          batches: out.batches,
          reconciled_to_ready_count: out.reconciledToReady,
        },
        "job_status_reconcile_run",
      );
    },
    { connection: getRedisConnection(), concurrency: 1 },
  );

  registerWorkerShutdown({
    worker,
    closeQueues: [closeJobStatusReconcileQueue],
    prismaDisconnect: () => prisma.$disconnect(),
  });
}

void main().catch((err) => {
  logger.error(
    { event: "job_status_reconcile_worker_boot_failed", err },
    "job_status_reconcile_worker_boot_failed",
  );
  process.exitCode = 1;
});
