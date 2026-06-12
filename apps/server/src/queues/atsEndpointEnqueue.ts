import type { Queue } from "bullmq";
import { logger } from "../utils/logger.js";
import {
  INGEST_ATS_ENDPOINT_JOB,
  type IngestAtsEndpointPayload,
} from "./ats-endpoint.queue.js";

export type AtsEndpointEnqueueAction =
  | "enqueued"
  | "skipped_duplicate"
  | "reclaimed_failed";

export type AtsEndpointEnqueueResult = {
  action: AtsEndpointEnqueueAction;
  endpointId: string;
  jobId: string;
};

export function atsEndpointJobId(endpointId: string): string {
  return `ingest-${endpointId}`;
}

type JobsOptions = {
  priority?: number;
  delay?: number;
};

/**
 * Stable endpoint-level dedup via BullMQ jobId lookup.
 * Does not scan the queue — uses getJob(jobId) only.
 */
export async function enqueueAtsEndpointIngest(
  queue: Queue,
  endpointId: string,
  options?: JobsOptions,
): Promise<AtsEndpointEnqueueResult> {
  const jobId = atsEndpointJobId(endpointId);
  const payload: IngestAtsEndpointPayload = { endpointId };

  const existing = await queue.getJob(jobId);
  if (!existing) {
    await queue.add(INGEST_ATS_ENDPOINT_JOB, payload, { jobId, ...options });
    logger.info({ event: "endpoint_enqueue", endpointId, jobId }, "endpoint_enqueue");
    return { action: "enqueued", endpointId, jobId };
  }

  const state = await existing.getState();

  if (state === "waiting" || state === "active" || state === "delayed") {
    logger.info(
      { event: "endpoint_skip_duplicate", endpointId, jobId, state },
      "endpoint_skip_duplicate",
    );
    return { action: "skipped_duplicate", endpointId, jobId };
  }

  if (state === "failed") {
    await existing.remove();
    await queue.add(INGEST_ATS_ENDPOINT_JOB, payload, { jobId, ...options });
    logger.info(
      { event: "endpoint_reclaim_failed", endpointId, jobId },
      "endpoint_reclaim_failed",
    );
    return { action: "reclaimed_failed", endpointId, jobId };
  }

  // completed or unknown — allow re-enqueue
  await queue.add(INGEST_ATS_ENDPOINT_JOB, payload, { jobId, ...options });
  logger.info({ event: "endpoint_enqueue", endpointId, jobId, priorState: state }, "endpoint_enqueue");
  return { action: "enqueued", endpointId, jobId };
}
