import { loadRootEnv } from "../../infrastructure/env/loadEnv.js";
import { logger } from "../../utils/logger.js";
import { assertWorkerProcessEnv } from "../../infrastructure/env/validateWorkerEnv.js";
import {
  ARCHIVE_STALE_APPLICATIONS_JOB,
  closeApplicationsArchiveQueue,
  getApplicationsArchiveQueue,
} from "../../queues/applicationsArchive.queue.js";
import { closeRedisConnection } from "../../queues/job.queue.js";

/**
 * Registers a repeatable BullMQ job (daily 02:00 UTC) to archive stale applications.
 * Run once at deploy / boot; repeatable metadata lives in Redis.
 */
async function main(): Promise<void> {
  loadRootEnv();
  assertWorkerProcessEnv();

  const queue = getApplicationsArchiveQueue();

  await queue.add(
    ARCHIVE_STALE_APPLICATIONS_JOB,
    {},
    {
      repeat: {
        pattern: "0 2 * * *",
        tz: "Etc/UTC",
      },
      jobId: "repeat:archive-stale-applications",
    },
  );

  logger.info({ event: "archive_applications_scheduler_registered" }, "archive_applications_scheduler_registered");

  await closeApplicationsArchiveQueue();
  await closeRedisConnection();
  process.exit(0);
}

void main().catch((err) => {
  logger.error({ event: "archive_applications_scheduler_failed", err }, "archive_applications_scheduler_failed");
  process.exit(1);
});
