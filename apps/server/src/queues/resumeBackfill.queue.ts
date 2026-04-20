import { Queue } from "bullmq";
import { getRedisConnection } from "./job.queue.js";

export const RESUME_BACKFILL_QUEUE_NAME = "resume-backfill";
export const RESUME_BACKFILL_TICK_JOB = "resume_backfill_tick";

export type ResumeBackfillPayload = Record<string, never>;

let queueSingleton: Queue | null = null;

export function getResumeBackfillQueue(): Queue {
  if (queueSingleton) return queueSingleton;
  queueSingleton = new Queue(RESUME_BACKFILL_QUEUE_NAME, {
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

export async function closeResumeBackfillQueue(): Promise<void> {
  if (!queueSingleton) return;
  await queueSingleton.close();
  queueSingleton = null;
}
