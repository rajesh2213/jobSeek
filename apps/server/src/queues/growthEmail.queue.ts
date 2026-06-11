import { Queue } from "bullmq";
import { getRedisConnection } from "./job.queue.js";

export const GROWTH_EMAIL_QUEUE_NAME = "growth-email";

export const GROWTH_EMAIL_DAILY_DIGEST = "growth_email_daily_digest";
export const GROWTH_EMAIL_WEEKLY_DIGEST = "growth_email_weekly_digest";
export const GROWTH_EMAIL_REENGAGEMENT = "growth_email_reengagement";
export const GROWTH_EMAIL_PERSONALIZED = "growth_email_personalized";
export const GROWTH_EMAIL_EVENT_WELCOME = "growth_email_event_welcome";
export const GROWTH_EMAIL_EVENT_FOLLOWUP = "growth_email_event_followup";
export const GROWTH_EMAIL_EVENT_SAVED_SEARCH_SUGGESTIONS =
  "growth_email_event_saved_search_suggestions";

export type GrowthEmailCampaignJobName =
  | typeof GROWTH_EMAIL_DAILY_DIGEST
  | typeof GROWTH_EMAIL_WEEKLY_DIGEST
  | typeof GROWTH_EMAIL_REENGAGEMENT
  | typeof GROWTH_EMAIL_PERSONALIZED
  | typeof GROWTH_EMAIL_EVENT_WELCOME
  | typeof GROWTH_EMAIL_EVENT_FOLLOWUP
  | typeof GROWTH_EMAIL_EVENT_SAVED_SEARCH_SUGGESTIONS;

export interface GrowthEmailBatchPayload {
  page?: number;
  pageSize?: number;
}

export interface GrowthEmailEventPayload {
  userId: string;
  email?: string;
  jobId?: string;
  savedSearchId?: string;
  source?: string;
}

let growthEmailQueueSingleton: Queue | null = null;

export function getGrowthEmailQueue(): Queue {
  if (growthEmailQueueSingleton) return growthEmailQueueSingleton;
  growthEmailQueueSingleton = new Queue(GROWTH_EMAIL_QUEUE_NAME, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    },
  });
  return growthEmailQueueSingleton;
}

export async function closeGrowthEmailQueue(): Promise<void> {
  if (!growthEmailQueueSingleton) return;
  await growthEmailQueueSingleton.close();
  growthEmailQueueSingleton = null;
}
