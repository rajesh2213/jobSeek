import { Worker } from "bullmq";
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { logger } from "../utils/logger.js";
import { assertWorkerProcessEnv } from "../infrastructure/env/validateWorkerEnv.js";
import { registerWorkerShutdown } from "../utils/workerShutdown.js";
import { getRedisConnection } from "../queues/job.queue.js";
import {
  OPENCLAW_QUEUE_NAME,
  OPENCLAW_SYNC_JOB,
  closeOpenclawQueue,
} from "../queues/openclaw.queue.js";
import { createJobRepository } from "../modules/job/job.repository.js";
import { JobService } from "../modules/job/job.service.js";
import { createCompanyRepository } from "../modules/company/company.repository.js";
import { CompanyService } from "../modules/company/company.service.js";
import { runOpenClawSync } from "../modules/providers/providers/openclaw/openclaw.sync.js";
import { loadOpenClawEnv, isOpenClawConfiguredForSync } from "../modules/providers/providers/openclaw/openclaw.env.js";

function isSyncPayload(data: unknown): data is { triggeredAt?: string } {
  return typeof data === "object" && data !== null;
}

async function start(): Promise<void> {
  loadRootEnv();
  const cfg = loadOpenClawEnv();
  if (!isOpenClawConfiguredForSync(cfg)) {
    logger.info(
      { event: "openclaw_worker_disabled", provider: "openclaw" },
      "openclaw_worker_exit_clean",
    );
    return;
  }

  assertWorkerProcessEnv();

  const jobRepository = createJobRepository(prisma);
  const companyService = new CompanyService(createCompanyRepository(prisma), jobRepository);
  const jobService = new JobService(jobRepository);

  const worker = new Worker(
    OPENCLAW_QUEUE_NAME,
    async (job) => {
      if (job.name !== OPENCLAW_SYNC_JOB) {
        logger.warn({ event: "openclaw_unknown_job", name: job.name }, "openclaw_unknown_job");
        return;
      }
      if (!isSyncPayload(job.data)) {
        logger.warn({ event: "openclaw_bad_payload" }, "openclaw_bad_payload");
        return;
      }

      try {
        const result = await runOpenClawSync({
          prisma,
          jobService,
          companyService,
          jobRepository,
        });
        if (!result.ok) {
          logger.warn(
            {
              event: "openclaw_sync_finished_with_errors",
              provider: "openclaw",
              stopReason: result.stopReason,
              jobsProcessed: result.jobsProcessed,
            },
            "openclaw_sync_finished_with_errors",
          );
        }
      } catch (err) {
        logger.error({ event: "openclaw_sync_unhandled", provider: "openclaw", err }, "openclaw_sync_unhandled");
      }
    },
    { connection: getRedisConnection(), concurrency: 1 },
  );

  worker.on("failed", (job, err) => {
    const n = failureLogCounter + 1;
    failureLogCounter = n;
    if (n === 1 || n % 20 === 0) {
      logger.warn({ event: "openclaw_worker_job_failed", jobId: job?.id, n, err }, "openclaw_worker_job_failed");
    }
  });

  registerWorkerShutdown({
    worker,
    closeQueues: [closeOpenclawQueue],
    prismaDisconnect: () => prisma.$disconnect(),
  });
}

let failureLogCounter = 0;

void start().catch((err) => {
  logger.error({ event: "openclaw_worker_boot_failed", err }, "openclaw_worker_boot_failed");
  process.exitCode = 1;
});
