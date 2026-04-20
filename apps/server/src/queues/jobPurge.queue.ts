import { Queue } from "bullmq";
import { getRedisConnection } from "./job.queue.js";

export const JOB_PURGE_QUEUE_NAME = "job-purge";
export const JOB_PURGE_TICK = "job_purge_tick";

export type JobPurgePayload = Record<string, never>;

let queueSingleton: Queue | null = null;

export function getJobPurgeQueue(): Queue {
  if (queueSingleton) return queueSingleton;
  queueSingleton = new Queue(JOB_PURGE_QUEUE_NAME, {
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

export async function closeJobPurgeQueue(): Promise<void> {
  if (!queueSingleton) return;
  await queueSingleton.close();
  queueSingleton = null;
}
