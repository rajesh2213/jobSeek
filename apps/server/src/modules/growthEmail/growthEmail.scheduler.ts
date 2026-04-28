import { loadRootEnv } from "../../infrastructure/env/loadEnv.js";
import { logger } from "../../utils/logger.js";
import { assertWorkerProcessEnv } from "../../infrastructure/env/validateWorkerEnv.js";
import {
  GROWTH_EMAIL_DAILY_DIGEST,
  GROWTH_EMAIL_REENGAGEMENT,
  GROWTH_EMAIL_WEEKLY_DIGEST,
  closeGrowthEmailQueue,
  getGrowthEmailQueue,
} from "../../queues/growthEmail.queue.js";
import { closeRedisConnection } from "../../queues/job.queue.js";

async function main(): Promise<void> {
  loadRootEnv();
  assertWorkerProcessEnv();
  const queue = getGrowthEmailQueue();

  await queue.add(
    GROWTH_EMAIL_DAILY_DIGEST,
    {},
    {
      repeat: { pattern: "0 8 * * *", tz: "Etc/UTC" },
      jobId: "repeat:growth-email-daily",
    },
  );
  await queue.add(
    GROWTH_EMAIL_WEEKLY_DIGEST,
    {},
    {
      repeat: { pattern: "0 9 * * 1", tz: "Etc/UTC" },
      jobId: "repeat:growth-email-weekly",
    },
  );
  await queue.add(
    GROWTH_EMAIL_REENGAGEMENT,
    {},
    {
      repeat: { pattern: "30 10 * * *", tz: "Etc/UTC" },
      jobId: "repeat:growth-email-reengagement",
    },
  );

  logger.info({ event: "growth_email_scheduler_registered" }, "growth_email_scheduler_registered");
  await closeGrowthEmailQueue();
  await closeRedisConnection();
  process.exit(0);
}

void main().catch((err) => {
  logger.error({ event: "growth_email_scheduler_failed", err }, "growth_email_scheduler_failed");
  process.exit(1);
});
