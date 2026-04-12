import { Queue } from "bullmq";
import { getRedisConnection } from "./job.queue.js";

export const APPLICATIONS_ARCHIVE_QUEUE_NAME = "applications-archive";

export const ARCHIVE_STALE_APPLICATIONS_JOB = "archive_stale_applications";

export type ArchiveStaleApplicationsPayload = Record<string, never>;

let applicationsArchiveQueueSingleton: Queue | null = null;

export function getApplicationsArchiveQueue(): Queue {
  if (applicationsArchiveQueueSingleton) return applicationsArchiveQueueSingleton;
  applicationsArchiveQueueSingleton = new Queue(APPLICATIONS_ARCHIVE_QUEUE_NAME, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 2,
      backoff: { type: "exponential", delay: 5000 },
    },
  });
  return applicationsArchiveQueueSingleton;
}

export async function closeApplicationsArchiveQueue(): Promise<void> {
  if (!applicationsArchiveQueueSingleton) return;
  await applicationsArchiveQueueSingleton.close();
  applicationsArchiveQueueSingleton = null;
}
