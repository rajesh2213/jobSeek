import { Queue } from "bullmq";
import { getRedisConnection } from "./job.queue.js";

export const COMPANY_SCORE_QUEUE_NAME = "company-score";

export const SCORE_RECOMPUTE_JOB = "score-recompute";

export interface ScoreRecomputePayload {
  companyId: string;
}

let scoreQueueSingleton: Queue | null = null;

export function getCompanyScoreQueue(): Queue {
  if (scoreQueueSingleton) return scoreQueueSingleton;

  scoreQueueSingleton = new Queue(COMPANY_SCORE_QUEUE_NAME, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: 500,
      removeOnFail: 1000,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
    },
  });

  return scoreQueueSingleton;
}

export async function closeCompanyScoreQueue(): Promise<void> {
  if (!scoreQueueSingleton) return;
  await scoreQueueSingleton.close();
  scoreQueueSingleton = null;
}
