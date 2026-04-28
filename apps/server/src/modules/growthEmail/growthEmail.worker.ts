import { Worker } from "bullmq";
import type { GrowthEmailCampaignType } from "./growthEmail.types.js";
import { loadRootEnv } from "../../infrastructure/env/loadEnv.js";
import { prisma } from "../../infrastructure/db/prisma.js";
import { logger } from "../../utils/logger.js";
import { assertWorkerProcessEnv } from "../../infrastructure/env/validateWorkerEnv.js";
import { registerWorkerShutdown } from "../../utils/workerShutdown.js";
import {
  GROWTH_EMAIL_DAILY_DIGEST,
  GROWTH_EMAIL_EVENT_FOLLOWUP,
  GROWTH_EMAIL_EVENT_SAVED_SEARCH_SUGGESTIONS,
  GROWTH_EMAIL_EVENT_WELCOME,
  GROWTH_EMAIL_PERSONALIZED,
  GROWTH_EMAIL_QUEUE_NAME,
  GROWTH_EMAIL_REENGAGEMENT,
  GROWTH_EMAIL_WEEKLY_DIGEST,
  closeGrowthEmailQueue,
} from "../../queues/growthEmail.queue.js";
import { getRedisConnection } from "../../queues/job.queue.js";
import { runGrowthEmailCampaign } from "./growthEmail.service.js";

const JOB_TO_CAMPAIGN: Record<string, GrowthEmailCampaignType> = {
  [GROWTH_EMAIL_DAILY_DIGEST]: "daily_digest",
  [GROWTH_EMAIL_WEEKLY_DIGEST]: "weekly_digest",
  [GROWTH_EMAIL_REENGAGEMENT]: "reengagement",
  [GROWTH_EMAIL_PERSONALIZED]: "personalized",
  [GROWTH_EMAIL_EVENT_WELCOME]: "event_welcome",
  [GROWTH_EMAIL_EVENT_FOLLOWUP]: "event_followup",
  [GROWTH_EMAIL_EVENT_SAVED_SEARCH_SUGGESTIONS]: "event_saved_search_suggestions",
};

async function main(): Promise<void> {
  loadRootEnv();
  assertWorkerProcessEnv();
  logger.info({ event: "growth_email_worker_start" }, "growth_email_worker_start");

  const worker = new Worker(
    GROWTH_EMAIL_QUEUE_NAME,
    async (job) => {
      const campaignType = JOB_TO_CAMPAIGN[job.name];
      if (!campaignType) return;
      const data = (job.data ?? {}) as { userId?: string; page?: number; pageSize?: number };
      const result = await runGrowthEmailCampaign({
        prisma,
        campaignType,
        userId: data.userId,
        page: data.page,
        pageSize: data.pageSize,
      });
      logger.info(
        { event: "growth_email_job_done", jobName: job.name, campaignType, ...result },
        "growth_email_job_done",
      );
      return result;
    },
    { connection: getRedisConnection() },
  );

  registerWorkerShutdown({
    worker,
    closeQueues: [closeGrowthEmailQueue],
    prismaDisconnect: () => prisma.$disconnect(),
  });
}

void main().catch((err) => {
  logger.error({ event: "growth_email_worker_boot_failed", err }, "growth_email_worker_boot_failed");
  process.exitCode = 1;
});
