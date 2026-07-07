import { Worker } from "bullmq";
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { logger } from "../utils/logger.js";
import { CompanyStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";
import {
  getJobQueue,
  getRedisConnection,
  getIoredis,
  JOB_QUEUE_NAME,
  closeJobQueue,
} from "../queues/job.queue.js";
import { getCompanyScoreQueue, closeCompanyScoreQueue } from "../queues/companyScore.queue.js";
import { assertWorkerProcessEnv } from "../infrastructure/env/validateWorkerEnv.js";
import { registerWorkerShutdown } from "../utils/workerShutdown.js";
import { CompanyService } from "../modules/company/company.service.js";
import { createCompanyRepository } from "../modules/company/company.repository.js";
import { createJobRepository } from "../modules/job/job.repository.js";
import { JobService } from "../modules/job/job.service.js";
import { extractCompanyDomain } from "../utils/jobFingerprint.js";
import {
  CRAWL_COMPANY_JOBS,
  INGEST_ATS_JOBS,
  INGEST_JOBS_FROM_SOURCE,
  INGEST_JOBS_FROM_SOURCE_URL,
  PROCESS_JOB,
  type CrawlCompanyJobsPayload,
  type IngestJobsFromSourcePayload,
  type IngestJobsFromSourceUrlPayload,
  type NormalizedJob,
} from "../modules/crawler/crawler.types.js";
import { processIngestJobsFromSource } from "../services/fallbackJobIngestion.service.js";
import { processIngestJobsFromSourceUrl } from "../services/jobSourceUrlIngestion.service.js";
import { ENRICH_PRIORITY_JOB_DISCOVERED } from "../queues/enrich-company.queue.js";
import { isSupportedAtsType, type AtsType } from "../modules/ats/ats.interface.js";
import { createAtsCrawlerStandard } from "../modules/ats/AtsCrawlerStandard.js";
import { enrichCanonicalJobParsedDescription } from "../modules/ai/jobDescriptionEnrichment.js";
import { takeAndResetParseStartsInWindow } from "../modules/ai/ai.service.js";
import { shouldEnqueueJob } from "../services/recentJobSeen.service.js";
import { normalizeJobUrl } from "../utils/normalizeJobUrl.js";
import { recordIngestionFinished } from "../services/companyScore.service.js";
import { startWorkerHeartbeat } from "../services/workerHeartbeat.service.js";
import { hostname } from "node:os";
import { computeJobContentHash } from "../utils/jobContentHash.js";
import {
  assertRequiredSelect,
  logCacheHitMetrics,
  logEfficiencyMetrics,
  logQueryMetrics,
} from "../utils/queryMetrics.js";
import { hashedCacheKey } from "../utils/cacheKey.js";
import {
  estimateJsonBytes,
  logUpdateReturnBytesEstimate,
  logUpdateReturnClassification,
  logUpdateReturnOptimized,
} from "../utils/dbPayloadDebug.js";
import {
  finalizeHashCacheHitAfterRecovery,
  computePersistedContentHash,
} from "../utils/workdayHashCacheRecovery.js";
import { workdayNeedsDetailRecovery } from "../modules/ats/workday/workdayPoisoned.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomIntInclusive(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function throttleApiCall(): Promise<void> {
  const delay = randomIntInclusive(100, 300);
  await sleep(delay);
}

type CrawlErrorType = "timeout" | "network" | "parse" | "unknown";

function classifyCrawlError(err: unknown): CrawlErrorType {
  if (err instanceof SyntaxError) return "parse";
  if (err instanceof TypeError) return "network";
  if (err instanceof Error) {
    const message = err.message.toLowerCase();
    if (
      err.name === "AbortError" ||
      err.name === "TimeoutError" ||
      message.includes("timed out") ||
      message.includes("timeout")
    ) {
      return "timeout";
    }
    if (message.includes("unexpected") && message.includes("response shape")) {
      return "parse";
    }
  }
  return "unknown";
}

function validateCrawlCompanyJobsPayload(
  data: unknown,
): CrawlCompanyJobsPayload | null {
  if (!isRecord(data)) return null;
  const companyId = data.companyId;
  const companyName = data.companyName;
  const greenhouseBoardToken = data.greenhouseBoardToken;
  const atsType = data.atsType;
  const atsBoardToken = data.atsBoardToken;
  const crawlEnqueuedAtMs =
    typeof data.crawlEnqueuedAtMs === "number" && Number.isFinite(data.crawlEnqueuedAtMs)
      ? data.crawlEnqueuedAtMs
      : undefined;
  if (
    !(companyId === undefined || typeof companyId === "string") ||
    typeof companyName !== "string" ||
    typeof greenhouseBoardToken !== "string" ||
    !(atsType === undefined || typeof atsType === "string") ||
    !(atsBoardToken === undefined || typeof atsBoardToken === "string")
  ) {
    return null;
  }
  const normalizedAtsType =
    typeof atsType === "string" && isSupportedAtsType(atsType)
      ? atsType
      : undefined;
  return {
    companyId,
    companyName,
    greenhouseBoardToken,
    atsType: normalizedAtsType,
    atsBoardToken,
    crawlEnqueuedAtMs,
  };
}

function validateNormalizedJob(data: unknown): NormalizedJob | null {
  if (!isRecord(data)) return null;
  const title = data.title;
  const sourceUrl = data.sourceUrl;
  const companyId = data.companyId;
  const source = data.source;
  const isRemote = data.isRemote;
  if (typeof title !== "string") return null;
  if (typeof sourceUrl !== "string") return null;
  if (typeof companyId !== "string") return null;
  if (!isSupportedAtsType(String(source))) return null;
  if (typeof isRemote !== "boolean") return null;

  const description = typeof data.description === "string" ? data.description : undefined;
  const location = typeof data.location === "string" ? data.location : undefined;
  let postedAt: Date | undefined;
  if (data.postedAt instanceof Date) {
    postedAt = data.postedAt;
  } else if (typeof data.postedAt === "string") {
    const d = new Date(data.postedAt);
    postedAt = Number.isNaN(d.getTime()) ? undefined : d;
  }

  const atsJobId =
    typeof data.atsJobId === "string" && data.atsJobId.trim() !== ""
      ? data.atsJobId
      : undefined;

  const applyUrl =
    typeof data.applyUrl === "string" && data.applyUrl.trim() !== ""
      ? data.applyUrl.trim()
      : undefined;

  const companyName =
    typeof data.companyName === "string" && data.companyName.trim() !== ""
      ? data.companyName.trim()
      : undefined;

  const jobId =
    typeof data.jobId === "string" && data.jobId.trim() !== "" ? data.jobId.trim() : undefined;

  const batchTouchAtMs =
    typeof data.batchTouchAtMs === "number" && Number.isFinite(data.batchTouchAtMs)
      ? data.batchTouchAtMs
      : undefined;

  return {
    title,
    description,
    location,
    isRemote,
    source: source as AtsType,
    sourceUrl: normalizeJobUrl(sourceUrl.trim()),
    applyUrl,
    postedAt,
    companyId,
    companyName,
    atsJobId,
    jobId,
    ...(batchTouchAtMs !== undefined ? { batchTouchAtMs } : {}),
  };
}

function validateIngestJobsFromSourcePayload(
  data: unknown,
): IngestJobsFromSourcePayload | null {
  if (!isRecord(data)) return null;
  if (typeof data.companyId !== "string" || typeof data.companyName !== "string") {
    return null;
  }
  return {
    companyId: data.companyId,
    companyName: data.companyName,
    domain: typeof data.domain === "string" ? data.domain : null,
    wellfoundUrl: typeof data.wellfoundUrl === "string" ? data.wellfoundUrl : null,
  };
}

function validateIngestJobsFromSourceUrlPayload(
  data: unknown,
): IngestJobsFromSourceUrlPayload | null {
  if (!isRecord(data)) return null;
  if (
    typeof data.companyId !== "string" ||
    typeof data.companyName !== "string" ||
    typeof data.url !== "string" ||
    !data.url.trim()
  ) {
    return null;
  }
  return {
    companyId: data.companyId,
    companyName: data.companyName,
    url: data.url.trim(),
  };
}

interface CrawlSummaryCounters {
  jobsFetched: number;
  jobsInserted: number;
  jobsUpdated: number;
  failures: number;
}

const PROCESS_JOB_ADD_CHUNK = Math.max(10, Math.min(100, Number(process.env.PROCESS_JOB_ADD_CHUNK_SIZE ?? "50") || 50));
const HASH_CACHE_NAMESPACE = "job_hash:jobWorker";
const HASH_CACHE_TTL_SECONDS = Math.max(3600, Math.min(21600, Number(process.env.JOB_HASH_CACHE_TTL_SECONDS ?? "10800") || 10800));
// REQUIRED_SELECT
const JOB_CANONICAL_HASH_SELECT = {
  id: true,
  contentHash: true,
  lastSeenAt: true,
  lastProcessedAt: true,
} as const;

type JobCanonicalHashRow = {
  id: string;
  contentHash: string | null;
  lastSeenAt: Date;
  lastProcessedAt: Date | null;
};

function processingLookbackDays(): number {
  return Math.max(1, Number(process.env.PROCESSING_LOOKBACK_DAYS ?? "7") || 7);
}

function processingLookbackSince(nowMs = Date.now()): Date {
  return new Date(nowMs - processingLookbackDays() * 24 * 60 * 60 * 1000);
}

let skipNextProcessJobForBackpressure = false;
let jobHashCacheHits = 0;
let jobHashCacheMisses = 0;

function jobWorkerConcurrency(): number {
  const n = Number(process.env.WORKER_CONCURRENCY ?? "5");
  return Math.max(1, Math.min(32, Number.isFinite(n) ? n : 5));
}

async function start(): Promise<void> {
  logUpdateReturnClassification({
    location: "jobWorker.processJob.cachedSkip.updateMany",
    classification: "NO_RETURN_NEEDED",
  });
  logUpdateReturnOptimized({
    location: "jobWorker.processJob.cachedSkip.updateMany",
    strategy: "updateMany",
  });
  logUpdateReturnClassification({
    location: "jobWorker.processJob.finalize.updateMany",
    classification: "NO_RETURN_NEEDED",
  });
  logUpdateReturnOptimized({
    location: "jobWorker.processJob.finalize.updateMany",
    strategy: "updateMany",
  });

  loadRootEnv();
  assertWorkerProcessEnv();
  startWorkerHeartbeat("job-processing");

  const jobWorkerConc = jobWorkerConcurrency();
  logger.info(
    {
      event: "worker_concurrency_config",
      worker: "job",
      jobWorkerConcurrency: jobWorkerConc,
    },
    "worker_concurrency_config",
  );

  const jobRepository = createJobRepository(prisma);
  const companyService = new CompanyService(
    createCompanyRepository(prisma),
    jobRepository,
  );
  const jobService = new JobService(jobRepository);
  const redis = getIoredis();
  const queue = getJobQueue();
  getCompanyScoreQueue();
  const crawlCounters = new Map<string, CrawlSummaryCounters>();

  let processJobCompletions = 0;
  const windowMs = 60_000;
  let lastThroughputLog = Date.now();
  const queueMetricsInterval = setInterval(
    () => {
      const now = Date.now();
      const elapsed = Math.max(1, now - lastThroughputLog);
      const n = processJobCompletions;
      processJobCompletions = 0;
      const parseN = takeAndResetParseStartsInWindow();
      lastThroughputLog = now;
      const jobsPerMin = (n / elapsed) * 60_000;
      const parsePerMin = (parseN / elapsed) * 60_000;
      void (async () => {
        try {
          const c = await queue.getJobCounts("wait", "active", "delayed", "failed", "completed");
          logger.info(
            {
              event: "worker_queue_snapshot",
              processJobCompletions: n,
              parseStartsInWindow: parseN,
              windowMs: elapsed,
              jobsPerMinApprox: Math.round(jobsPerMin * 100) / 100,
              parseCallsPerMinApprox: Math.round(parsePerMin * 100) / 100,
              host: hostname(),
              pid: process.pid,
              ...c,
            },
            "worker_queue_snapshot",
          );
        } catch (err) {
          logger.warn({ event: "queue_metrics_failed", err }, "queue_metrics_failed");
        }
      })();
    },
    windowMs,
  );
  (queueMetricsInterval as NodeJS.Timeout).unref();

  const worker = new Worker(
    JOB_QUEUE_NAME,
    async (bullJob) => {
      if (bullJob.name === CRAWL_COMPANY_JOBS || bullJob.name === INGEST_ATS_JOBS) {
        const payload = validateCrawlCompanyJobsPayload(bullJob.data);
        if (!payload) throw new Error("Invalid crawl-company-jobs payload");

        const {
          companyId: companyIdFromPayload,
          companyName,
          greenhouseBoardToken,
          atsType: atsTypeFromPayload,
          atsBoardToken: atsBoardTokenFromPayload,
          crawlEnqueuedAtMs,
        } = payload;

        let ingestionCompanyId: string | null = null;
        try {
          const company =
            companyIdFromPayload
              ? await companyService.findById(companyIdFromPayload)
              : await companyService.findByAtsBoardToken(
                  atsBoardTokenFromPayload ?? greenhouseBoardToken,
                );
          if (!company) {
            logger.warn(
              {
                event: "crawl_company_not_found",
                companyName,
                atsType: atsTypeFromPayload ?? "greenhouse",
              },
              "Company not found for ATS token; skipping crawl",
            );
            return;
          }
          const resolvedCompanyId = company.id;
          const resolvedAtsType =
            company.atsType ?? atsTypeFromPayload ?? "greenhouse";
          const resolvedToken =
            company.atsBoardToken ??
            atsBoardTokenFromPayload ??
            greenhouseBoardToken;
          if (!isSupportedAtsType(resolvedAtsType)) {
            throw new Error(
              `Unsupported ATS type on company ${resolvedCompanyId}: ${resolvedAtsType}`,
            );
          }
          const atsAdapter = createAtsCrawlerStandard(resolvedAtsType);

          // If an endpoint row exists for this company + ATS type, skip the legacy ATS crawl
          // to prevent old/new pipeline duplication (when endpoint ingestion is enabled).
          try {
            const endpoint = await prisma.atsEndpoint.findFirst({
              where: {
                type: resolvedAtsType,
                isActive: true,
                OR: [
                  { companyId: resolvedCompanyId },
                  {
                    companyLinks: { some: { companyId: resolvedCompanyId } },
                  },
                ],
              },
              select: { id: true },
            });
            if (endpoint) {
              logger.info(
                {
                  event: "skip_old_ats_ingestion_due_to_endpoint",
                  companyId: resolvedCompanyId,
                  atsType: resolvedAtsType,
                  endpointId: endpoint.id,
                },
                "skip_old_ats_ingestion_due_to_endpoint",
              );
              return;
            }
          } catch (err) {
            // If AtsEndpoint table is not present, proceed with legacy ingestion.
            if (
              err instanceof Prisma.PrismaClientKnownRequestError &&
              err.code === "P2021"
            ) {
              logger.error(
                {
                  event: "skip_old_ats_ingestion_endpoint_table_missing",
                  companyId: resolvedCompanyId,
                  atsType: resolvedAtsType,
                  err,
                },
                "skip_old_ats_ingestion_endpoint_table_missing",
              );
            } else {
              logger.warn(
                {
                  event: "skip_old_ats_ingestion_endpoint_lookup_failed",
                  companyId: resolvedCompanyId,
                  atsType: resolvedAtsType,
                  err,
                },
                "skip_old_ats_ingestion_endpoint_lookup_failed",
              );
            }
          }

          ingestionCompanyId = resolvedCompanyId;

          const crawlQueueWaitMs =
            typeof crawlEnqueuedAtMs === "number" && Number.isFinite(crawlEnqueuedAtMs)
              ? Date.now() - crawlEnqueuedAtMs
              : null;
          logger.info(
            {
              event: "crawl_start",
              companyId: resolvedCompanyId,
              companyName,
              atsType: resolvedAtsType,
              queueWaitMs: crawlQueueWaitMs,
            },
            "crawl started",
          );
          const THIRTY_MIN_MS = 30 * 60 * 1000;
          if (crawlQueueWaitMs != null && crawlQueueWaitMs > THIRTY_MIN_MS) {
            logger.warn(
              {
                event: "crawl_queue_wait_high",
                companyId: resolvedCompanyId,
                queueWaitMs: crawlQueueWaitMs,
                thresholdMs: THIRTY_MIN_MS,
              },
              "crawl_queue_wait_high",
            );
          }

          await throttleApiCall();
          const fetchStart = Date.now();
          const endpointForAdapter = {
            type: resolvedAtsType,
            slug: String(resolvedToken),
            baseUrl: company?.careersUrl ?? "",
            metadata: { crawlToken: resolvedToken },
            companyId: resolvedCompanyId,
            companyName: company.name,
          };

          const normalizedJobs = await atsAdapter.fetchJobs(endpointForAdapter as any);
          logQueryMetrics("jobWorker.atsFetch.normalizedJobs", normalizedJobs, 900);

          const fetchDurationMs = Date.now() - fetchStart;
          logger.info(
            {
              event: "ats_fetch_latency",
              atsType: resolvedAtsType,
              companyId: resolvedCompanyId,
              duration_ms: fetchDurationMs,
            },
            "ATS fetch latency",
          );

          logger.info(
            {
              event: "jobs_parsed",
              companyId: resolvedCompanyId,
              count: normalizedJobs.length,
              atsType: resolvedAtsType,
            },
            "Parsed ATS job list",
          );

          const sourceUrls = normalizedJobs.map((job) =>
            normalizeJobUrl(String(job.sourceUrl).trim()),
          );
          const batchSeenAt = new Date();
          const batchTouchAtMs = batchSeenAt.getTime();
          const jobsUpdated = await jobService.touchLastSeenBySourceUrls(
            sourceUrls,
            batchSeenAt,
          );

          let enqueueFailures = 0;
          let recentDuplicateSkips = 0;
          for (let i = 0; i < normalizedJobs.length; i += PROCESS_JOB_ADD_CHUNK) {
            const batch = normalizedJobs.slice(i, i + PROCESS_JOB_ADD_CHUNK);
            const results = await Promise.allSettled(
              batch.map(async (j) => {
                const normalizedUrl = normalizeJobUrl(String(j.sourceUrl).trim());
                const shouldEnqueue = await shouldEnqueueJob(normalizedUrl);
                if (!shouldEnqueue) {
                  recentDuplicateSkips += 1;
                  logger.info(
                    {
                      event: "job_skipped_recent_duplicate",
                      companyId: resolvedCompanyId,
                      atsType: resolvedAtsType,
                      sourceUrl: normalizedUrl,
                    },
                    "job_skipped_recent_duplicate",
                  );
                  return;
                }
                await queue.add(PROCESS_JOB, {
                  ...j,
                  sourceUrl: normalizedUrl,
                  batchTouchAtMs,
                });
              }),
            );
            for (let k = 0; k < results.length; k++) {
              const r = results[k]!;
              if (r.status === "rejected") {
                enqueueFailures += 1;
                logger.error(
                  {
                    event: "process_job_enqueue_failed",
                    companyId: resolvedCompanyId,
                    atsType: resolvedAtsType,
                    sourceUrl: batch[k]!.sourceUrl,
                    err: r.reason,
                  },
                  "Failed to enqueue process-job",
                );
              }
            }
          }

          const jobsFetched = normalizedJobs.length;
          if (jobsFetched === 0) {
            logger.info(
              {
                event: "crawl_summary",
                companyId: resolvedCompanyId,
                atsType: resolvedAtsType,
                jobs_fetched: 0,
                jobs_inserted: 0,
                jobs_updated: jobsUpdated,
              recent_duplicate_skips: recentDuplicateSkips,
                failures: enqueueFailures,
              },
              "Company crawl completed",
            );
            try {
              await recordIngestionFinished(prisma, resolvedCompanyId, true, {
                crawlEnqueuedAtMs:
                  typeof crawlEnqueuedAtMs === "number" && Number.isFinite(crawlEnqueuedAtMs)
                    ? crawlEnqueuedAtMs
                    : undefined,
              });
            } catch (recErr) {
              logger.warn(
                { event: "ingestion_metrics_record_failed", companyId: resolvedCompanyId, err: recErr },
                "ingestion_metrics_record_failed",
              );
            }
            return;
          }

          crawlCounters.set(resolvedCompanyId, {
            jobsFetched,
            jobsInserted: 0,
            jobsUpdated,
            failures: enqueueFailures,
          });
          try {
            await recordIngestionFinished(prisma, resolvedCompanyId, true, {
              crawlEnqueuedAtMs:
                typeof crawlEnqueuedAtMs === "number" && Number.isFinite(crawlEnqueuedAtMs)
                  ? crawlEnqueuedAtMs
                  : undefined,
            });
          } catch (recErr) {
            logger.warn(
              { event: "ingestion_metrics_record_failed", companyId: resolvedCompanyId, err: recErr },
              "ingestion_metrics_record_failed",
            );
          }
        } catch (err) {
          if (ingestionCompanyId) {
            try {
              await recordIngestionFinished(prisma, ingestionCompanyId, false);
            } catch (recErr) {
              logger.warn(
                {
                  event: "ingestion_metrics_record_failed",
                  companyId: ingestionCompanyId,
                  err: recErr,
                },
                "ingestion_metrics_record_failed",
              );
            }
          }
          const errorType = classifyCrawlError(err);
          logger.error(
            {
              event: "crawl_company_failed",
              companyId: companyIdFromPayload,
              companyName,
              atsType: atsTypeFromPayload ?? "greenhouse",
              errorType,
              err,
            },
            "Per-company crawl failed; skipping",
          );
        throw err;
        }
        return;
      }

      if (bullJob.name === INGEST_JOBS_FROM_SOURCE) {
        const payload = validateIngestJobsFromSourcePayload(bullJob.data);
        if (!payload) throw new Error("Invalid ingest-jobs-from-source payload");
        await processIngestJobsFromSource(prisma, jobService, payload);
        return;
      }

      if (bullJob.name === INGEST_JOBS_FROM_SOURCE_URL) {
        const payload = validateIngestJobsFromSourceUrlPayload(bullJob.data);
        if (!payload) throw new Error("Invalid ingest-jobs-from-source-url payload");
        await processIngestJobsFromSourceUrl(prisma, jobService, payload);
        return;
      }

      if (bullJob.name === PROCESS_JOB) {
        const payload = validateNormalizedJob(bullJob.data);
        if (!payload) throw new Error("Invalid process-job payload");
        if (skipNextProcessJobForBackpressure) {
          skipNextProcessJobForBackpressure = false;
          logger.warn(
            { event: "job_worker_skipped_low_efficiency_backpressure", sourceUrl: payload.sourceUrl },
            "job_worker_skipped_low_efficiency_backpressure",
          );
          return;
        }
        const newContentHash = computeJobContentHash({
          title: payload.title,
          description: payload.description,
          applyUrl: payload.applyUrl ?? payload.sourceUrl,
        });
        const hashCacheKey = hashedCacheKey(HASH_CACHE_NAMESPACE, payload.sourceUrl);
        try {
          const cachedHash = await redis.get(hashCacheKey);
          if (cachedHash === newContentHash) {
            const action = await finalizeHashCacheHitAfterRecovery(prisma, redis, {
              hashCacheKey,
              hashCacheTtlSeconds: HASH_CACHE_TTL_SECONDS,
              processedAt: new Date(),
              job: {
                sourceUrl: payload.sourceUrl,
                source: payload.source,
                title: payload.title,
                description: payload.description,
                applyUrl: payload.applyUrl ?? payload.sourceUrl,
                candidatePostedAt: payload.postedAt,
              },
              inlineRepairEnabled:
                process.env.WORKDAY_HASH_HIT_INLINE_REPAIR?.trim() === "true",
            });
            if (action === "skip_ingest") {
              jobHashCacheHits += 1;
              if ((jobHashCacheHits + jobHashCacheMisses) % 100 === 0) {
                logCacheHitMetrics({
                  name: "jobWorker.processJob.hashCache",
                  hits: jobHashCacheHits,
                  misses: jobHashCacheMisses,
                });
              }
              logEfficiencyMetrics({
                name: "jobWorker.processJob.cachedSkip",
                readRows: 0,
                updatedRows: 1,
                skippedRows: 0,
              });
              return;
            }
          }
          jobHashCacheMisses += 1;
          if ((jobHashCacheHits + jobHashCacheMisses) % 100 === 0) {
            logCacheHitMetrics({
              name: "jobWorker.processJob.hashCache",
              hits: jobHashCacheHits,
              misses: jobHashCacheMisses,
            });
          }
        } catch (err) {
          logger.warn({ event: "job_hash_cache_read_failed", sourceUrl: payload.sourceUrl, err }, "job_hash_cache_read_failed");
        }

        let companyNameHint = payload.companyName;
        if (!companyNameHint) {
          const existingCo = await companyService.findById(payload.companyId);
          companyNameHint = existingCo?.name;
        }
        const { companyId: resolvedCompanyId } =
          await companyService.ensureCompanyFromJob({
            preferredCompanyId: payload.companyId,
            companyName: companyNameHint,
          });

        const company = await companyService.findById(resolvedCompanyId);
        const companyDomain = extractCompanyDomain(
          company?.careersUrl,
          resolvedCompanyId,
        );
        let result: { canonical: { id: string }; inserted: boolean };
        try {
          result = await jobService.ingestDeduplicated(
            {
              ...payload,
              companyId: resolvedCompanyId,
              companyDomain,
            },
            { batchTouchAtMs: payload.batchTouchAtMs, redis },
          );
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2002"
          ) {
            logger.info(
              { event: "job_duplicate_sourceUrl", sourceUrl: payload.sourceUrl },
              "job_duplicate_sourceUrl",
            );
            return;
          }
          throw err;
        }

        const canonicalRow = (await prisma.job.findUnique({
          where: { id: result.canonical.id },
          select: JOB_CANONICAL_HASH_SELECT,
        })) as JobCanonicalHashRow | null;
        assertRequiredSelect("Job", "jobWorker.processJob.findUnique", JOB_CANONICAL_HASH_SELECT);
        const now = new Date();
        const lookbackSince = processingLookbackSince(now.getTime());
        const withinWindow =
          canonicalRow?.lastSeenAt != null && canonicalRow.lastSeenAt >= lookbackSince;
        const needsProcessing =
          canonicalRow != null &&
          (canonicalRow.lastProcessedAt == null ||
            canonicalRow.lastSeenAt.getTime() > canonicalRow.lastProcessedAt.getTime());
        let updatedRows = 0;
        let skippedRows = 0;
        if (!withinWindow || !needsProcessing || canonicalRow?.contentHash === newContentHash) {
          const updateRes = await prisma.job.updateMany({
            where: { id: result.canonical.id },
            data: {
              lastProcessedAt: now,
              contentHash: newContentHash,
            } as Prisma.JobUpdateManyMutationInput,
          });
          if (updateRes.count === 0) {
            throw new Error(`jobWorker.processJob.finalize.skipParse_missing_row:${result.canonical.id}`);
          }
          logUpdateReturnBytesEstimate({
            location: "jobWorker.processJob.finalize.skipParse",
            estimatedBytes: estimateJsonBytes({
              id: result.canonical.id,
              lastProcessedAt: now,
              contentHash: newContentHash,
            }),
            rows: 1,
          });
          skippedRows = 1;
        } else {
          await enrichCanonicalJobParsedDescription(
            prisma,
            jobRepository,
            result.canonical.id,
            result.inserted,
          );
          const updateRes = await prisma.job.updateMany({
            where: { id: result.canonical.id },
            data: {
              lastProcessedAt: now,
              contentHash: newContentHash,
            } as Prisma.JobUpdateManyMutationInput,
          });
          if (updateRes.count === 0) {
            throw new Error(`jobWorker.processJob.finalize.afterParse_missing_row:${result.canonical.id}`);
          }
          logUpdateReturnBytesEstimate({
            location: "jobWorker.processJob.finalize.afterParse",
            estimatedBytes: estimateJsonBytes({
              id: result.canonical.id,
              lastProcessedAt: now,
              contentHash: newContentHash,
            }),
            rows: 1,
          });
          updatedRows = 1;
        }
        try {
          const skipPoisonHash = workdayNeedsDetailRecovery({
            source: payload.source,
            description: payload.description,
            sourceUrl: payload.sourceUrl,
            detailNeedsRecovery: payload.detailNeedsRecovery,
          });
          if (!skipPoisonHash) {
            const persistHash = await computePersistedContentHash(prisma, payload.sourceUrl, {
              sourceUrl: payload.sourceUrl,
              source: payload.source,
              title: payload.title,
              description: payload.description,
              applyUrl: payload.applyUrl ?? payload.sourceUrl,
            });
            await redis.set(hashCacheKey, persistHash, "EX", HASH_CACHE_TTL_SECONDS);
          }
        } catch (err) {
          logger.warn({ event: "job_hash_cache_write_failed", sourceUrl: payload.sourceUrl, err }, "job_hash_cache_write_failed");
        }
        const efficiency = logEfficiencyMetrics({
          name: "jobWorker.processJob",
          readRows: 1,
          updatedRows,
          skippedRows,
        });
        if (efficiency < 0.05) {
          skipNextProcessJobForBackpressure = true;
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
        const counters = crawlCounters.get(resolvedCompanyId);
        if (result.inserted) {
          if (counters) counters.jobsInserted += 1;
          logger.info(
            {
              event: "job_inserted",
              jobTitle: payload.title,
              sourceUrl: payload.sourceUrl,
              companyId: resolvedCompanyId,
              source: payload.source,
              canonicalId: result.canonical.id,
            },
            "Job processed and stored (dedup pipeline)",
          );
        }

        if (counters) {
          const processed =
            counters.jobsInserted + counters.jobsUpdated + counters.failures;
          if (processed >= counters.jobsFetched) {
            logger.info(
              {
                event: "crawl_summary",
                companyId: resolvedCompanyId,
                atsType: payload.source,
                jobs_fetched: counters.jobsFetched,
                jobs_inserted: counters.jobsInserted,
                jobs_updated: counters.jobsUpdated,
                failures: counters.failures,
              },
              "Company crawl completed",
            );
            crawlCounters.delete(resolvedCompanyId);
          }
        }
        return;
      }

      throw new Error(`Unknown job name: ${bullJob.name}`);
    },
    {
      connection: getRedisConnection(),
      concurrency: jobWorkerConc,
    },
  );

  worker.on("completed", (job) => {
    if (job.name === PROCESS_JOB) {
      processJobCompletions += 1;
    }
  });

  worker.on("failed", (job, err) => {
    if (job?.name === PROCESS_JOB) {
      const payload = validateNormalizedJob(job.data);
      if (payload) {
        const counters = crawlCounters.get(payload.companyId);
        const maxAttempts =
          typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
        const isTerminalFailure = job.attemptsMade >= maxAttempts;
        if (counters && isTerminalFailure) {
          counters.failures += 1;
          const processed =
            counters.jobsInserted + counters.jobsUpdated + counters.failures;
          if (processed >= counters.jobsFetched) {
            logger.info(
              {
                event: "crawl_summary",
                companyId: payload.companyId,
                atsType: payload.source,
                jobs_fetched: counters.jobsFetched,
                jobs_inserted: counters.jobsInserted,
                jobs_updated: counters.jobsUpdated,
                failures: counters.failures,
              },
              "Company crawl completed",
            );
            crawlCounters.delete(payload.companyId);
          }
        }
        if (isTerminalFailure) {
          void (async () => {
            try {
              const existing = await jobRepository.findBySourceUrl(payload.sourceUrl);
              if (!existing) return;
              const canonical = await jobRepository.resolveCanonicalJob(existing);
              await jobRepository.markJobFailedFromProcessing(
                canonical.id,
                "process_job_terminal_failure",
              );
            } catch (markErr) {
              logger.warn(
                {
                  event: "job_status_mark_failed_terminal_error",
                  sourceUrl: payload.sourceUrl,
                  err: markErr,
                },
                "job_status_mark_failed_terminal_error",
              );
            }
          })();
        }
      }
    }

    logger.error(
      {
        event: "worker_job_failed",
        jobId: job?.id,
        name: job?.name,
        err,
      },
      "Worker job failed",
    );
  });

  registerWorkerShutdown({
    worker,
    closeQueues: [closeJobQueue, closeCompanyScoreQueue],
    prismaDisconnect: () => prisma.$disconnect(),
  });
}

void start().catch((err) => {
  logger.error({ event: "job_worker_boot_failed", err }, "job_worker_boot_failed");
  process.exitCode = 1;
});

