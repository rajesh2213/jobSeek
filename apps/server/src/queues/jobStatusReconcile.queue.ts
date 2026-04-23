import { Queue } from "bullmq";
import { getRedisConnection } from "./job.queue.js";

export const JOB_STATUS_RECONCILE_QUEUE_NAME = "job-status-reconcile";
export const JOB_STATUS_RECONCILE_TICK = "job_status_reconcile_tick";

let queueSingleton: Queue | null = null;

export function getJobStatusReconcileQueue(): Queue {
  if (queueSingleton) return queueSingleton;
  queueSingleton = new Queue(JOB_STATUS_RECONCILE_QUEUE_NAME, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 2,
      backoff: { type: "exponential", delay: 5000 },
    },
  });
  return queueSingleton;
}

export async function closeJobStatusReconcileQueue(): Promise<void> {
  if (!queueSingleton) return;
  await queueSingleton.close();
  queueSingleton = null;
}
