import { Queue } from "bullmq";
import { getRedisConnection } from "./job.queue.js";

export const SERP_QUEUE_NAME = "serp-ingestion";
export const RUN_SERP_BATCH_JOB = "run_serp_batch";

export type RunSerpBatchPayload = Record<string, never>;

let serpQueueSingleton: Queue | null = null;

export function getSerpQueue(): Queue {
  if (serpQueueSingleton) return serpQueueSingleton;
  serpQueueSingleton = new Queue(SERP_QUEUE_NAME, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 2,
      backoff: { type: "exponential", delay: 5000 },
    },
  });
  return serpQueueSingleton;
}

export async function closeSerpQueue(): Promise<void> {
  if (!serpQueueSingleton) return;
  await serpQueueSingleton.close();
  serpQueueSingleton = null;
}

