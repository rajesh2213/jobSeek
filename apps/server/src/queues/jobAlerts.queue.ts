import { Queue } from "bullmq";
import { getRedisConnection } from "./job.queue.js";

export const JOB_ALERTS_QUEUE_NAME = "job-alerts";

export const JOB_ALERTS_TICK = "job_alerts_tick";

export type JobAlertsTickPayload = Record<string, never>;

let jobAlertsQueueSingleton: Queue | null = null;

export function getJobAlertsQueue(): Queue {
  if (jobAlertsQueueSingleton) return jobAlertsQueueSingleton;
  jobAlertsQueueSingleton = new Queue(JOB_ALERTS_QUEUE_NAME, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 2,
      backoff: { type: "exponential", delay: 5000 },
    },
  });
  return jobAlertsQueueSingleton;
}

export async function closeJobAlertsQueue(): Promise<void> {
  if (!jobAlertsQueueSingleton) return;
  await jobAlertsQueueSingleton.close();
  jobAlertsQueueSingleton = null;
}
