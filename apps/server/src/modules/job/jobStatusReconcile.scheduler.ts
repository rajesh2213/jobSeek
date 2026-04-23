import { loadRootEnv } from "../../infrastructure/env/loadEnv.js";
import { logger } from "../../utils/logger.js";
import { assertWorkerProcessEnv } from "../../infrastructure/env/validateWorkerEnv.js";
import { closeRedisConnection } from "../../queues/job.queue.js";
import {
  closeJobStatusReconcileQueue,
  getJobStatusReconcileQueue,
  JOB_STATUS_RECONCILE_TICK,
} from "../../queues/jobStatusReconcile.queue.js";

async function main(): Promise<void> {
  loadRootEnv();
  assertWorkerProcessEnv();

  const queue = getJobStatusReconcileQueue();
  await queue.add(
    JOB_STATUS_RECONCILE_TICK,
    {},
    {
      repeat: {
        pattern: "*/10 * * * *",
        tz: "Etc/UTC",
      },
      jobId: "repeat:job-status-reconcile",
    },
  );

  logger.info(
    { event: "job_status_reconcile_scheduler_registered" },
    "job_status_reconcile_scheduler_registered",
  );
  await closeJobStatusReconcileQueue();
  await closeRedisConnection();
  process.exit(0);
}

void main().catch((err) => {
  logger.error(
    { event: "job_status_reconcile_scheduler_failed", err },
    "job_status_reconcile_scheduler_failed",
  );
  process.exit(1);
});
