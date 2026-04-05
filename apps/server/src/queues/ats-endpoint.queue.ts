import { Queue } from "bullmq";
import { getRedisConnection } from "./job.queue.js";

export const INGEST_ATS_ENDPOINT_QUEUE_NAME = "ingest-ats-endpoint";

export const INGEST_ATS_ENDPOINT_JOB = "ingest-ats-endpoint";

export type IngestAtsEndpointPayload = {
  endpointId: string;
};

let ingestAtsEndpointQueueSingleton: Queue | null = null;

export function getIngestAtsEndpointQueue(): Queue {
  if (ingestAtsEndpointQueueSingleton) return ingestAtsEndpointQueueSingleton;

  ingestAtsEndpointQueueSingleton = new Queue(INGEST_ATS_ENDPOINT_QUEUE_NAME, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: true,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnFail: false,
    },
  });

  return ingestAtsEndpointQueueSingleton;
}

export async function closeIngestAtsEndpointQueue(): Promise<void> {
  if (!ingestAtsEndpointQueueSingleton) return;
  await ingestAtsEndpointQueueSingleton.close();
  ingestAtsEndpointQueueSingleton = null;
}
