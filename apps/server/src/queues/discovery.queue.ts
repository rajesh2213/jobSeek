import { Queue } from "bullmq";
import { getRedisConnection } from "./job.queue.js";

export const DISCOVERY_QUEUE_NAME = "company-discovery";

let discoveryQueueSingleton: Queue | null = null;

export function getDiscoveryQueue(): Queue {
  if (discoveryQueueSingleton) return discoveryQueueSingleton;

  discoveryQueueSingleton = new Queue(DISCOVERY_QUEUE_NAME, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    },
  });
  return discoveryQueueSingleton;
}

export async function closeDiscoveryQueue(): Promise<void> {
  if (!discoveryQueueSingleton) return;
  await discoveryQueueSingleton.close();
  discoveryQueueSingleton = null;
}
