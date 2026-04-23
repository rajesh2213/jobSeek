import { Worker } from "bullmq";
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { logger } from "../utils/logger.js";
import { CompanyStatus } from "@prisma/client";
import {
  processEnrichCompany,
  isTransientEnrichmentError,
} from "../services/companyEnrichment.service.js";
import {
  ENRICH_COMPANY_QUEUE_NAME,
  ENRICH_COMPANY_JOB,
  type EnrichCompanyJobPayload,
  getEnrichCompanyQueue,
  enqueueDeferredCompanyEnrichment,
} from "../queues/enrich-company.queue.js";
import { getRedisConnection } from "../queues/job.queue.js";
import { closeEnrichCompanyQueue } from "../queues/enrich-company.queue.js";
import { assertWorkerProcessEnv } from "../infrastructure/env/validateWorkerEnv.js";
import { registerWorkerShutdown } from "../utils/workerShutdown.js";
import {
  recordEnrichmentAttempt,
  recordEnrichmentFailure,
} from "../services/companyDiscoveryMetrics.service.js";
import { resolveDeferredEnrichmentPriority } from "../services/enrichmentPriority.service.js";
import { ensureAtsEndpointTableReady } from "../modules/atsEndpoint/atsEndpointReadiness.js";

function isPayload(data: unknown): data is EnrichCompanyJobPayload {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof (data as EnrichCompanyJobPayload).companyId === "string" &&
    typeof (data as EnrichCompanyJobPayload).companyName === "string"
  );
}

async function start(): Promise<void> {
  loadRootEnv();
  assertWorkerProcessEnv();
  await ensureAtsEndpointTableReady(prisma, "enrich_worker_boot");

  getEnrichCompanyQueue();

  const enrichConc = Math.max(
    1,
    Math.min(
      32,
      Number(
        process.env.ENRICH_COMPANY_WORKER_CONCURRENCY ?? process.env.WORKER_CONCURRENCY ?? "4",
      ) || 4,
    ),
  );
  logger.info(
    {
      event: "worker_concurrency_config",
      worker: "enrich-company",
      enrichCompanyWorkerConcurrency: enrichConc,
    },
    "worker_concurrency_config",
  );

  const worker = new Worker(
    ENRICH_COMPANY_QUEUE_NAME,
    async (job) => {
      if (job.name !== ENRICH_COMPANY_JOB) {
        throw new Error(`Unknown enrich job name: ${job.name}`);
      }
      if (!isPayload(job.data)) {
        throw new Error("Invalid enrich-company payload");
      }
      recordEnrichmentAttempt();
      try {
        await processEnrichCompany(prisma, job.data.companyId);
      } catch (err) {
        if (isTransientEnrichmentError(err)) throw err;
        logger.error(
          { event: "enrich_company_job_error", companyId: job.data.companyId, err },
          "enrich_company_job_error",
        );
      }
    },
    {
      connection: getRedisConnection(),
      concurrency: enrichConc,
    },
  );

  worker.on("failed", (job, err) => {
    if (job?.name !== ENRICH_COMPANY_JOB) return;
    const maxAttempts = typeof job.opts.attempts === "number" ? job.opts.attempts : 2;
    const terminal = job.attemptsMade >= maxAttempts;
    if (!terminal || !isPayload(job.data)) return;

    recordEnrichmentFailure();

    if (isTransientEnrichmentError(err)) {
      void (async () => {
        try {
          await prisma.company.updateMany({
            where: {
              id: job.data.companyId,
              status: { not: CompanyStatus.ready },
            },
            data: { status: CompanyStatus.enriching },
          });
          const pr = await resolveDeferredEnrichmentPriority(prisma, job.data.companyId);
          await enqueueDeferredCompanyEnrichment(job.data.companyId, job.data.companyName, {
            priority: pr,
          });
          logger.warn(
            {
              event: "company_enrichment_transient_exhausted",
              companyId: job.data.companyId,
              attempts: job.attemptsMade,
              err,
            },
            "company_enrichment_transient_exhausted",
          );
        } catch (e) {
          logger.error(
            { event: "company_enrichment_recovery_failed", err: e },
            "company_enrichment_recovery_failed",
          );
        }
      })();
      return;
    }

    logger.warn(
      {
        event: "company_enrichment_job_failed",
        companyId: job.data.companyId,
        attempts: job.attemptsMade,
        err,
      },
      "company_enrichment_job_failed",
    );
  });

  registerWorkerShutdown({
    worker,
    closeQueues: [closeEnrichCompanyQueue],
    prismaDisconnect: () => prisma.$disconnect(),
  });
}

void start().catch((err) => {
  logger.error({ event: "enrich_worker_boot_failed", err }, "enrich_worker_boot_failed");
  process.exitCode = 1;
});
