import { loadRootEnv } from "../../infrastructure/env/loadEnv.js";
import { logger } from "../../utils/logger.js";
import { assertWorkerProcessEnv } from "../../infrastructure/env/validateWorkerEnv.js";
import {
  closeJobPurgeQueue,
  getJobPurgeQueue,
  JOB_PURGE_TICK,
} from "../../queues/jobPurge.queue.js";
import { closeRedisConnection } from "../../queues/job.queue.js";

async function main(): Promise<void> {
  loadRootEnv();
  assertWorkerProcessEnv();

  const queue = getJobPurgeQueue();
  await queue.add(
    JOB_PURGE_TICK,
    {},
    {
      repeat: {
        pattern: "0 3 * * *",
        tz: "Etc/UTC",
      },
      jobId: "repeat:job-purge",
    },
  );

  logger.info({ event: "job_purge_scheduler_registered" }, "job_purge_scheduler_registered");
  await closeJobPurgeQueue();
  await closeRedisConnection();
  process.exit(0);
}

void main().catch((err) => {
  logger.error({ event: "job_purge_scheduler_failed", err }, "job_purge_scheduler_failed");
  process.exit(1);
});
