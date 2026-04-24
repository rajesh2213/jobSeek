import { Worker } from "bullmq";
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { logger } from "../utils/logger.js";
import { CompanyStatus } from "@prisma/client";
import { getRedisConnection } from "../queues/job.queue.js";
import { getCompanyScoreQueue, closeCompanyScoreQueue } from "../queues/companyScore.queue.js";
import {
  getIngestAtsEndpointQueue,
  closeIngestAtsEndpointQueue,
  INGEST_ATS_ENDPOINT_QUEUE_NAME,
  INGEST_ATS_ENDPOINT_JOB,
  type IngestAtsEndpointPayload,
} from "../queues/ats-endpoint.queue.js";
import { assertWorkerProcessEnv } from "../infrastructure/env/validateWorkerEnv.js";
import { registerWorkerShutdown } from "../utils/workerShutdown.js";
import { createCompanyRepository } from "../modules/company/company.repository.js";
import { createJobRepository } from "../modules/job/job.repository.js";
import { JobService } from "../modules/job/job.service.js";
import { CompanyService } from "../modules/company/company.service.js";
import { extractCompanyDomain } from "../utils/jobFingerprint.js";
import { createAtsEndpointService } from "../modules/atsEndpoint/atsEndpoint.service.js";
import { createAtsCrawlerStandard } from "../modules/ats/AtsCrawlerStandard.js";
import type { AtsType } from "../modules/ats/ats.interface.js";
import { ENRICH_PRIORITY_JOB_DISCOVERED } from "../queues/enrich-company.queue.js";
import {
  recordAtsIngestionOutcome,
  recordAtsIngestionSkippedRecent,
  recordAtsIngestionStarted,
} from "../services/atsPipelineCounters.service.js";
import { enrichCanonicalJobParsedDescription } from "../modules/ai/jobDescriptionEnrichment.js";
import { asyncPool } from "../utils/asyncPool.js";
import { chunkArray } from "../utils/chunkArray.js";
import type { NormalizedJob } from "../modules/crawler/crawler.types.js";
import { recordIngestionFinished } from "../services/companyScore.service.js";

// Avoid back-to-back fetches when lastCrawledAt was just set.
const MIN_MS_SINCE_LAST_CRAWL_FOR_INGEST = Math.floor(2.5 * 60 * 1000);

type AtsIngestErrorKind = "network_error" | "parser_error" | "crawler_error";

function isPayload(data: unknown): data is IngestAtsEndpointPayload {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof (data as IngestAtsEndpointPayload).endpointId === "string" &&
    Object.keys(data as object).length === 1
  );
}

function classifyAtsIngestError(err: unknown): AtsIngestErrorKind {
  if (err instanceof TypeError) return "network_error";
  if (err instanceof Error) {
    const m = err.message.toLowerCase();
    const name = err.name;
    if (
      name === "AbortError" ||
      name === "TimeoutError" ||
      m.includes("timed out") ||
      m.includes("timeout") ||
      m.includes("econnreset") ||
      m.includes("enotfound") ||
      m.includes("fetch failed") ||
      m.includes("network")
    ) {
      return "network_error";
    }
    if (
      m.includes("syntaxerror") ||
      m.includes("unexpected token") ||
      m.includes("invalid json") ||
      m.includes("parse")
    ) {
      return "parser_error";
    }
  }
  return "crawler_error";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomIntInclusive(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function throttleApiCall(): Promise<void> {
  await sleep(randomIntInclusive(100, 300));
}

function clampPoolSize(envName: string, fallback: string, hardMax: number): number {
  const n = Math.max(1, Math.min(hardMax, Number(process.env[envName] ?? fallback)));
  return Number.isFinite(n) ? n : Number(fallback);
}

async function start(): Promise<void> {
  loadRootEnv();
  assertWorkerProcessEnv();

  const jobRepository = createJobRepository(prisma);
  const companyService = new CompanyService(
    createCompanyRepository(prisma),
    jobRepository,
  );
  const jobService = new JobService(jobRepository);
  const endpointService = createAtsEndpointService(prisma);

  getIngestAtsEndpointQueue();
  getCompanyScoreQueue();

  const parsePoolConcurrency = clampPoolSize("ATS_PARSE_CONCURRENCY", "3", 4);
  const ingestPoolConcurrencyRaw = clampPoolSize("ATS_POOL_INGEST_CONCURRENCY", "3", 4);
  const ingestPoolConcurrency = Math.min(ingestPoolConcurrencyRaw, parsePoolConcurrency);
  const parseChunkSize = Math.max(10, Math.min(500, Number(process.env.ATS_PARSE_CHUNK_SIZE ?? "100") || 100));
  const bullConcurrency = Math.max(1, Math.min(4, Number(process.env.ATS_ENDPOINT_WORKER_CONCURRENCY ?? "1") || 1));

  logger.info(
    {
      event: "worker_concurrency_config",
      worker: "ats-endpoint",
      atsPoolIngestConcurrency: ingestPoolConcurrency,
      atsPoolIngestConcurrencyRaw: ingestPoolConcurrencyRaw,
      atsPoolParseConcurrency: parsePoolConcurrency,
      atsParseChunkSize: parseChunkSize,
      atsEndpointBullConcurrency: bullConcurrency,
      jobWorkerConc: Number(process.env.WORKER_CONCURRENCY ?? "5"),
    },
    "worker_concurrency_config",
  );

  const worker = new Worker(
    INGEST_ATS_ENDPOINT_QUEUE_NAME,
    async (job) => {
      if (job.name !== INGEST_ATS_ENDPOINT_JOB) {
        throw new Error(`Unknown ATS endpoint job name: ${job.name}`);
      }
      if (!isPayload(job.data)) {
        throw new Error("Invalid ingest-ats-endpoint payload (expected { endpointId } only)");
      }
      const { endpointId } = job.data;
      const emptyMeta = { endpointId, type: "", slug: "" };

      const endpointRow = await prisma.atsEndpoint.findUnique({
        where: { id: endpointId },
      });
      if (!endpointRow) {
        logger.error(
          {
            event: "ats_ingestion_failed",
            ...emptyMeta,
            errorKind: "parser_error" satisfies AtsIngestErrorKind,
            err: new Error("AtsEndpoint not found"),
          },
          "ats_ingestion_failed",
        );
        return;
      }

      const logBase = {
        endpointId,
        type: endpointRow.type,
        slug: endpointRow.slug,
      };

      if (endpointRow.lastCrawledAt != null) {
        const ageMs = Date.now() - endpointRow.lastCrawledAt.getTime();
        if (ageMs < MIN_MS_SINCE_LAST_CRAWL_FOR_INGEST) {
          recordAtsIngestionSkippedRecent(endpointRow.source);
          logger.info(
            {
              event: "ats_ingestion_skipped_recent_crawl",
              ...logBase,
              lastCrawledAt: endpointRow.lastCrawledAt.toISOString(),
              ageMs,
              minGapMs: MIN_MS_SINCE_LAST_CRAWL_FOR_INGEST,
            },
            "ats_ingestion_skipped_recent_crawl",
          );
          return;
        }
      }

      recordAtsIngestionStarted(endpointRow.source);
      logger.info(
        { event: "ats_ingestion_started", ...logBase },
        "ats_ingestion_started",
      );

      const { companyId: resolvedCompanyId } = await companyService.ensureCompanyFromJob({
        preferredCompanyId: endpointRow.companyId ?? undefined,
        companyName:
          endpointRow.companyName?.trim() ||
          `${endpointRow.type}:${endpointRow.slug.slice(0, 48)}`,
      });

      const company = await companyService.findById(resolvedCompanyId);
      if (!company) {
        const err = new Error("Company missing after ensureCompanyFromJob");
        logger.error(
          {
            event: "ats_ingestion_failed",
            ...logBase,
            errorKind: "parser_error" satisfies AtsIngestErrorKind,
            err,
          },
          "ats_ingestion_failed",
        );
        await endpointService.markFailure(endpointId);
        throw err;
      }

      const atsType = endpointRow.type as AtsType;
      const endpointForAdapter = {
        id: endpointRow.id,
        type: atsType,
        slug: endpointRow.slug,
        baseUrl: endpointRow.baseUrl,
        metadata: endpointRow.metadata,
        companyId: resolvedCompanyId,
        companyName: company.name,
      };

      let normalizedJobs;
      try {
        await throttleApiCall();
        const standard = createAtsCrawlerStandard(atsType);
        normalizedJobs = await standard.fetchJobs(endpointForAdapter);
      } catch (err) {
        const errorKind = classifyAtsIngestError(err);
        logger.error(
          {
            event: "ats_ingestion_failed",
            ...logBase,
            errorKind,
            err,
          },
          "ats_ingestion_failed",
        );
        await endpointService.markFailure(endpointId);
        try {
          await recordIngestionFinished(prisma, resolvedCompanyId, false);
        } catch (recErr) {
          logger.warn(
            {
              event: "ingestion_metrics_record_failed",
              companyId: resolvedCompanyId,
              err: recErr,
            },
            "ingestion_metrics_record_failed",
          );
        }
        throw err;
      }

      const companyDomain = extractCompanyDomain(
        company.careersUrl,
        resolvedCompanyId,
      );

      let failures = 0;
      let jobsInserted = 0;
      let duplicatesSkipped = 0;

      type IngestRow = { canonicalId: string; inserted: boolean; sourceUrl: string };

      const ingestResults = await asyncPool(
        normalizedJobs,
        ingestPoolConcurrency,
        async (normalizedJob: NormalizedJob): Promise<IngestRow | null> => {
          try {
            const { inserted, canonical } = await jobService.ingestDeduplicated({
              ...normalizedJob,
              companyDomain,
            });
            if (inserted) jobsInserted += 1;
            else duplicatesSkipped += 1;
            return { canonicalId: canonical.id, inserted, sourceUrl: normalizedJob.sourceUrl };
          } catch (err) {
            failures += 1;
            const errorKind = classifyAtsIngestError(err);
            logger.error(
              {
                event: "ats_ingestion_failed",
                ...logBase,
                errorKind,
                err,
                sourceUrl: normalizedJob.sourceUrl,
                phase: "ingest",
              },
              "ats_ingestion_failed",
            );
            return null;
          }
        },
      );

      const flatIngest: IngestRow[] = ingestResults.filter((r): r is IngestRow => r !== null);

      for (const chunk of chunkArray(flatIngest, parseChunkSize)) {
        await asyncPool(chunk, parsePoolConcurrency, async (row) => {
          try {
            await enrichCanonicalJobParsedDescription(
              prisma,
              jobRepository,
              row.canonicalId,
              row.inserted,
            );
          } catch (err) {
            failures += 1;
            const errorKind = classifyAtsIngestError(err);
            logger.error(
              {
                event: "ats_ingestion_failed",
                ...logBase,
                errorKind,
                err,
                sourceUrl: row.sourceUrl,
                phase: "parse",
              },
              "ats_ingestion_failed",
            );
          }
        });
      }

      recordAtsIngestionOutcome(endpointRow.source, {
        jobsFetched: normalizedJobs.length,
        jobsInsertedRows: jobsInserted,
        dupSkipped: duplicatesSkipped,
      });
      logger.info(
        {
          event: "ats_ingestion_summary",
          endpointId,
          atsType: endpointRow.type,
          jobsFetched: normalizedJobs.length,
          jobsInserted,
          duplicatesSkipped,
        },
        "ats_ingestion_summary",
      );

      const crawlCompletedAt = new Date();
      await prisma.atsEndpoint.update({
        where: { id: endpointId },
        data: { lastCrawledAt: crawlCompletedAt },
      });

      if (failures === 0) {
        await endpointService.markSuccess(endpointId);
      } else {
        await endpointService.markFailure(endpointId);
      }

      const coAfter = await companyService.findById(resolvedCompanyId);
      if (coAfter && coAfter.status !== CompanyStatus.ready) {
        await companyService
          .enqueueCompanyEnrichment(coAfter.id, coAfter.name, {
            priority: ENRICH_PRIORITY_JOB_DISCOVERED,
            jobId: `enrich-${coAfter.id}`,
          })
          .catch(() => {
            /* duplicate job id */
          });
      }

      logger.info(
        {
          event: "ats_ingestion_completed",
          ...logBase,
          jobs_fetched: normalizedJobs.length,
          ingest_failures: failures,
        },
        "ats_ingestion_completed",
      );

      try {
        await recordIngestionFinished(prisma, resolvedCompanyId, failures === 0);
      } catch (recErr) {
        logger.warn(
          {
            event: "ingestion_metrics_record_failed",
            companyId: resolvedCompanyId,
            err: recErr,
          },
          "ingestion_metrics_record_failed",
        );
      }
    },
    { connection: getRedisConnection(), concurrency: bullConcurrency },
  );

  worker.on("failed", (job, err) => {
    const endpointId =
      job?.data && typeof job.data === "object" && job.data !== null && "endpointId" in job.data
        ? String((job.data as { endpointId: unknown }).endpointId)
        : undefined;
    logger.error(
      {
        event: "ats_endpoint_worker_job_failed",
        jobId: job?.id,
        endpointId,
        err,
      },
      "ats_endpoint_worker_job_failed",
    );
  });

  logger.info(
    { event: "ats_endpoint_worker_started", queue: INGEST_ATS_ENDPOINT_QUEUE_NAME },
    "ats_endpoint_worker_started",
  );

  registerWorkerShutdown({
    worker,
    closeQueues: [closeIngestAtsEndpointQueue, closeCompanyScoreQueue],
    prismaDisconnect: () => prisma.$disconnect(),
  });
}

start().catch((err) => {
  logger.error({ event: "ats_endpoint_worker_boot_failed", err }, "ats_endpoint_worker_boot_failed");
  process.exitCode = 1;
});
