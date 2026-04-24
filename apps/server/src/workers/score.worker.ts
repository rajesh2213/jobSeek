import { Worker } from "bullmq";
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { logger } from "../utils/logger.js";
import { assertWorkerProcessEnv } from "../infrastructure/env/validateWorkerEnv.js";
import { registerWorkerShutdown } from "../utils/workerShutdown.js";
import { getRedisConnection } from "../queues/job.queue.js";
import {
  COMPANY_SCORE_QUEUE_NAME,
  SCORE_RECOMPUTE_JOB,
  type ScoreRecomputePayload,
  getCompanyScoreQueue,
  closeCompanyScoreQueue,
} from "../queues/companyScore.queue.js";
import { recomputeAndPersistCompanyScore } from "../services/companyScore.service.js";

function isPayload(data: unknown): data is ScoreRecomputePayload {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof (data as ScoreRecomputePayload).companyId === "string"
  );
}

async function start(): Promise<void> {
  loadRootEnv();
  assertWorkerProcessEnv();
  getCompanyScoreQueue();

  const worker = new Worker(
    COMPANY_SCORE_QUEUE_NAME,
    async (job) => {
      if (job.name !== SCORE_RECOMPUTE_JOB) {
        throw new Error(`Unknown company-score job name: ${job.name}`);
      }
      if (!isPayload(job.data)) {
        throw new Error("Invalid score-recompute payload");
      }
      await recomputeAndPersistCompanyScore(prisma, job.data.companyId);
    },
    {
      connection: getRedisConnection(),
      concurrency: Math.max(
        1,
        Math.min(16, Number(process.env.SCORE_WORKER_CONCURRENCY ?? "4") || 4),
      ),
    },
  );

  logger.info({ event: "score_worker_start" }, "Company score worker started");

  registerWorkerShutdown({
    worker,
    closeQueues: [closeCompanyScoreQueue],
    prismaDisconnect: () => prisma.$disconnect(),
  });
}

void start().catch((err) => {
  logger.error({ event: "score_worker_boot_failed", err }, "score_worker_boot_failed");
  process.exitCode = 1;
});
