import { loadRootEnv } from "../../infrastructure/env/loadEnv.js";
import { logger } from "../../utils/logger.js";
import { assertWorkerProcessEnv } from "../../infrastructure/env/validateWorkerEnv.js";
import { registerSchedulerShutdown } from "../../utils/schedulerShutdown.js";
import { closeRedisConnection } from "../../queues/job.queue.js";
import {
  DISCOVER_ATS_ENDPOINTS_QUEUE_NAME,
  DISCOVER_FROM_JOBS_JOB,
  DISCOVER_FROM_SERP_JOB,
  getAtsDiscoveryQueue,
  closeAtsDiscoveryQueue,
  VALIDATE_ENDPOINT_JOB,
} from "../../queues/atsDiscovery.queue.js";

const MIN_INTERVAL_MS = 5 * 60 * 1000;
const MAX_INTERVAL_MS = 10 * 60 * 1000;

const MIN_BATCH = 100;
const MAX_BATCH = 200;
const MAX_JITTER_MS = 2000;

function randomIntInclusive(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function enqueueDiscoveryBatch(): Promise<void> {
  const queue = getAtsDiscoveryQueue();
  const ts = Date.now();
  const serpBatch = randomIntInclusive(MIN_BATCH, MAX_BATCH);
  const jobsBatch = randomIntInclusive(MIN_BATCH, MAX_BATCH);
  const validateBatch = randomIntInclusive(10, 25);

  await sleepMs(randomIntInclusive(0, MAX_JITTER_MS));
  await queue.add(
    DISCOVER_FROM_SERP_JOB,
    { batchSize: serpBatch },
    { jobId: `discover-serp-${ts}-${serpBatch}` },
  );

  await sleepMs(randomIntInclusive(0, MAX_JITTER_MS));
  await queue.add(
    DISCOVER_FROM_JOBS_JOB,
    { batchSize: jobsBatch },
    { jobId: `discover-jobs-${ts}-${jobsBatch}` },
  );

  await sleepMs(randomIntInclusive(0, MAX_JITTER_MS));
  await queue.add(
    VALIDATE_ENDPOINT_JOB,
    { batchSize: validateBatch },
    { jobId: `validate-endpoints-${ts}-${validateBatch}` },
  );

  logger.info(
    {
      event: "ats_discovery_scheduler_enqueued",
      queue: DISCOVER_ATS_ENDPOINTS_QUEUE_NAME,
      jobs: [
        { name: DISCOVER_FROM_SERP_JOB, batchSize: serpBatch },
        { name: DISCOVER_FROM_JOBS_JOB, batchSize: jobsBatch },
        { name: VALIDATE_ENDPOINT_JOB, batchSize: validateBatch },
      ],
    },
    "ats_discovery_scheduler_enqueued",
  );
}

async function main(): Promise<void> {
  loadRootEnv();
  assertWorkerProcessEnv();
  void DISCOVER_ATS_ENDPOINTS_QUEUE_NAME;

  logger.info({ event: "ats_discovery_scheduler_started" }, "ats_discovery_scheduler_started");

  if (process.env.ATS_DISCOVERY_SCHEDULER_DISABLED?.trim() === "true") {
    logger.info(
      { event: "ats_discovery_scheduler_disabled", reason: "ATS_DISCOVERY_SCHEDULER_DISABLED" },
      "ats_discovery_scheduler_disabled",
    );
    await closeAtsDiscoveryQueue();
    await closeRedisConnection();
    process.exit(0);
    return;
  }

  await enqueueDiscoveryBatch().catch((err) => {
    logger.error({ event: "ats_discovery_scheduler_enqueue_failed", err }, "ats_discovery_scheduler_enqueue_failed");
  });

  const ms = randomIntInclusive(MIN_INTERVAL_MS, MAX_INTERVAL_MS);
  logger.info(
    {
      event: "ats_discovery_scheduler_interval_set",
      nextRunInMs: ms,
      nextRunInMinutes: Number((ms / 60_000).toFixed(2)),
    },
    "ats_discovery_scheduler_interval_set",
  );

  const interval = setInterval(() => {
    void enqueueDiscoveryBatch().catch((err) => {
      logger.error({ event: "ats_discovery_scheduler_enqueue_failed", err }, "ats_discovery_scheduler_enqueue_failed");
    });
  }, ms);

  registerSchedulerShutdown({
    intervalIds: [interval],
    closeQueues: [closeAtsDiscoveryQueue],
  });
}

void main().catch((err) => {
  logger.error({ event: "ats_discovery_scheduler_boot_failed", err }, "ats_discovery_scheduler_boot_failed");
  process.exitCode = 1;
});
