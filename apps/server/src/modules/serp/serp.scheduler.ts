import { loadRootEnv } from "../../infrastructure/env/loadEnv.js";
import { logger } from "../../utils/logger.js";
import { assertWorkerProcessEnv } from "../../infrastructure/env/validateWorkerEnv.js";
import {
  getSerpQueue,
  closeSerpQueue,
  RUN_SERP_BATCH_JOB,
  SERP_QUEUE_NAME,
} from "../../queues/serp.queue.js";
import { closeRedisConnection } from "../../queues/job.queue.js";

async function enqueueRun(): Promise<void> {
  const queue = getSerpQueue();
  const jobId = `serp-run-${Date.now()}`;
  await queue.add(
    RUN_SERP_BATCH_JOB,
    {},
    {
      jobId,
    },
  );
}

async function main(): Promise<void> {
  loadRootEnv();
  assertWorkerProcessEnv();
  void SERP_QUEUE_NAME;

  logger.info({ event: "serp_scheduler_started" }, "serp_scheduler_started");

  try {
    await enqueueRun();
    logger.info({ event: "serp_scheduler_enqueued_once" }, "serp_scheduler_enqueued_once");
  } catch (err) {
    logger.error({ event: "serp_scheduler_enqueue_failed", err }, "serp_scheduler_enqueue_failed");
    process.exitCode = 1;
  } finally {
    await closeSerpQueue();
    await closeRedisConnection();
  }

  process.exit(process.exitCode ?? 0);
}

void main().catch((err) => {
  logger.error({ event: "serp_scheduler_boot_failed", err }, "serp_scheduler_boot_failed");
  process.exitCode = 1;
});

