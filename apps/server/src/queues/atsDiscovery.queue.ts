import { Queue } from "bullmq";
import { getRedisConnection } from "./job.queue.js";

export const DISCOVER_ATS_ENDPOINTS_QUEUE_NAME = "discover-ats-endpoints";

export const DISCOVER_FROM_SERP_JOB = "discover_from_serp";
export const DISCOVER_FROM_JOBS_JOB = "discover_from_jobs";
export const VALIDATE_ENDPOINT_JOB = "validate_endpoint";

export type DiscoverFromSerpPayload = {
  batchSize?: number;
};

export type DiscoverFromJobsPayload = {
  batchSize?: number;
};

export type ValidateEndpointPayload = {
  batchSize?: number;
};

let atsDiscoveryQueueSingleton: Queue | null = null;

export function getAtsDiscoveryQueue(): Queue {
  if (atsDiscoveryQueueSingleton) return atsDiscoveryQueueSingleton;
  atsDiscoveryQueueSingleton = new Queue(DISCOVER_ATS_ENDPOINTS_QUEUE_NAME, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    },
  });
  return atsDiscoveryQueueSingleton;
}

export async function closeAtsDiscoveryQueue(): Promise<void> {
  if (!atsDiscoveryQueueSingleton) return;
  await atsDiscoveryQueueSingleton.close();
  atsDiscoveryQueueSingleton = null;
}
