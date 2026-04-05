import { Queue } from "bullmq";
import { logger } from "../utils/logger.js";
import { getRedisConnection } from "./job.queue.js";

export const ENRICH_COMPANY_QUEUE_NAME = "enrich-company";

/** BullMQ job name (same as queue id for clarity). */
export const ENRICH_COMPANY_JOB = "enrich-company";

/** Delay before re-trying enrichment when company is not yet ready. */
export const DEFERRED_REENRICH_DELAY_MS = 6 * 60 * 60 * 1000;

/** BullMQ: lower number = higher priority (see BullMQ prioritized jobs). */
export const ENRICH_PRIORITY_JOB_DISCOVERED = 1;
export const ENRICH_PRIORITY_DATASET_SEED = 2;
export const ENRICH_PRIORITY_DEFAULT = 5;
export const ENRICH_PRIORITY_BACKLOG = 8;
export const ENRICH_PRIORITY_DEFERRED_RETRY = 10;

export interface EnrichCompanyJobPayload {
  companyId: string;
  companyName: string;
}

let enrichQueueSingleton: Queue | null = null;

export function getEnrichCompanyQueue(): Queue {
  if (enrichQueueSingleton) return enrichQueueSingleton;

  enrichQueueSingleton = new Queue(ENRICH_COMPANY_QUEUE_NAME, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: 500,
      removeOnFail: false,
      /** Retry only transient failures; business outcomes complete without throwing. */
      attempts: 2,
      backoff: { type: "exponential", delay: 8000 },
    },
  });

  return enrichQueueSingleton;
}

export async function closeEnrichCompanyQueue(): Promise<void> {
  if (!enrichQueueSingleton) return;
  await enrichQueueSingleton.close();
  enrichQueueSingleton = null;
}

/**
 * Re-enqueue enrichment after a delay; does not fail the caller if the job is already queued.
 */
export async function enqueueDeferredCompanyEnrichment(
  companyId: string,
  companyName: string,
  opts?: { priority?: number },
): Promise<void> {
  const queue = getEnrichCompanyQueue();
  const priority = opts?.priority ?? ENRICH_PRIORITY_DEFERRED_RETRY;
  try {
    await queue.add(
      ENRICH_COMPANY_JOB,
      { companyId, companyName },
      {
        delay: DEFERRED_REENRICH_DELAY_MS,
        priority,
        /** One delayed slot per company; duplicate add is ignored (caught below). */
        jobId: `enrich-deferred-${companyId}`,
        attempts: 2,
        backoff: { type: "exponential", delay: 8000 },
      },
    );
  } catch (err) {
    logger.warn(
      { event: "deferred_reenrich_enqueue_failed", companyId, err },
      "Deferred re-enrich enqueue skipped or failed",
    );
  }
}
