import { Queue } from "bullmq";
import { getRedisConnection } from "./job.queue.js";

export const OPENCLAW_QUEUE_NAME = "openclaw-sync";

/** Single-shot sync job; failures must not retry aggressively (see worker opts). */
export const OPENCLAW_SYNC_JOB = "openclaw-sync-run";

let openclawQueueSingleton: Queue | null = null;

export function getOpenclawQueue(): Queue {
  if (openclawQueueSingleton) return openclawQueueSingleton;

  openclawQueueSingleton = new Queue(OPENCLAW_QUEUE_NAME, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: true,
      attempts: 1,
    },
  });
  return openclawQueueSingleton;
}

export async function closeOpenclawQueue(): Promise<void> {
  if (!openclawQueueSingleton) return;
  await openclawQueueSingleton.close();
  openclawQueueSingleton = null;
}
