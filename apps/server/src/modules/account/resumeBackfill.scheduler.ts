import { loadRootEnv } from "../../infrastructure/env/loadEnv.js";
import { logger } from "../../utils/logger.js";
import { assertWorkerProcessEnv } from "../../infrastructure/env/validateWorkerEnv.js";
import {
  closeResumeBackfillQueue,
  getResumeBackfillQueue,
  RESUME_BACKFILL_TICK_JOB,
} from "../../queues/resumeBackfill.queue.js";
import { closeRedisConnection } from "../../queues/job.queue.js";

async function main(): Promise<void> {
  loadRootEnv();
  assertWorkerProcessEnv();

  const queue = getResumeBackfillQueue();
  await queue.add(
    RESUME_BACKFILL_TICK_JOB,
    {},
    {
      repeat: {
        pattern: "*/15 * * * *",
        tz: "Etc/UTC",
      },
      jobId: "repeat:resume-backfill",
    },
  );

  logger.info(
    { event: "resume_backfill_scheduler_registered" },
    "resume_backfill_scheduler_registered",
  );

  await closeResumeBackfillQueue();
  await closeRedisConnection();
  process.exit(0);
}

void main().catch((err) => {
  logger.error(
    { event: "resume_backfill_scheduler_failed", err },
    "resume_backfill_scheduler_failed",
  );
  process.exit(1);
});
