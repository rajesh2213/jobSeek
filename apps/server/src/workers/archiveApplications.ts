import { Worker } from "bullmq";
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { logger } from "../utils/logger.js";
import { assertWorkerProcessEnv } from "../infrastructure/env/validateWorkerEnv.js";
import { registerWorkerShutdown } from "../utils/workerShutdown.js";
import {
  APPLICATIONS_ARCHIVE_QUEUE_NAME,
  ARCHIVE_STALE_APPLICATIONS_JOB,
  closeApplicationsArchiveQueue,
} from "../queues/applicationsArchive.queue.js";
import { getRedisConnection } from "../queues/job.queue.js";

const MS_DAY = 86400000;
const STALE_DAYS = 30;

async function runArchive(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_DAYS * MS_DAY);
  const result = await prisma.application.updateMany({
    where: {
      status: "applied",
      archived: false,
      appliedAt: { lt: cutoff },
    },
    data: { archived: true },
  });
  return result.count;
}

async function main(): Promise<void> {
  loadRootEnv();
  assertWorkerProcessEnv();

  logger.info({ event: "archive_applications_worker_start" }, "archive_applications_worker_start");

  const worker = new Worker(
    APPLICATIONS_ARCHIVE_QUEUE_NAME,
    async (job) => {
      if (job.name !== ARCHIVE_STALE_APPLICATIONS_JOB) {
        return;
      }
      const archivedCount = await runArchive();
      logger.info(
        { event: "archive_applications_run", archivedCount, runAt: new Date().toISOString() },
        "archive_applications_completed",
      );
      return { archivedCount };
    },
    { connection: getRedisConnection() },
  );

  registerWorkerShutdown({
    worker,
    closeQueues: [closeApplicationsArchiveQueue],
    prismaDisconnect: () => prisma.$disconnect(),
  });
}

void main().catch((err) => {
  logger.error({ event: "archive_applications_worker_boot_failed", err }, "archive_applications_worker_boot_failed");
  process.exitCode = 1;
});
