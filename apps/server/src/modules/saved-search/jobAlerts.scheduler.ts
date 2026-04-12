import { loadRootEnv } from "../../infrastructure/env/loadEnv.js";
import { logger } from "../../utils/logger.js";
import { assertWorkerProcessEnv } from "../../infrastructure/env/validateWorkerEnv.js";
import {
  JOB_ALERTS_TICK,
  closeJobAlertsQueue,
  getJobAlertsQueue,
} from "../../queues/jobAlerts.queue.js";
import { closeRedisConnection } from "../../queues/job.queue.js";

/**
 * Registers a repeatable BullMQ job every 30 minutes for saved-search email alerts.
 */
async function main(): Promise<void> {
  loadRootEnv();
  assertWorkerProcessEnv();

  const queue = getJobAlertsQueue();

  await queue.add(
    JOB_ALERTS_TICK,
    {},
    {
      repeat: {
        pattern: "*/30 * * * *",
        tz: "Etc/UTC",
      },
      jobId: "repeat:job-alerts",
    },
  );

  logger.info({ event: "job_alerts_scheduler_registered" }, "job_alerts_scheduler_registered");

  await closeJobAlertsQueue();
  await closeRedisConnection();
  process.exit(0);
}

void main().catch((err) => {
  logger.error({ event: "job_alerts_scheduler_failed", err }, "job_alerts_scheduler_failed");
  process.exit(1);
});
