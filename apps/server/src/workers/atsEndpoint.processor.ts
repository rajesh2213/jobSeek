import { Worker, type Job, UnrecoverableError } from "bullmq";
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { logger } from "../utils/logger.js";
import { CompanyStatus } from "@prisma/client";
import { getIoredis, getRedisConnection } from "../queues/job.queue.js";
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
import { startWorkerHeartbeat } from "../services/workerHeartbeat.service.js";
import { createCompanyRepository } from "../modules/company/company.repository.js";
import { createJobRepository } from "../modules/job/job.repository.js";
import { JobService } from "../modules/job/job.service.js";
import { CompanyService } from "../modules/company/company.service.js";
import { extractCompanyDomain } from "../utils/jobFingerprint.js";
import { companyDisplayName } from "../utils/companyDisplayName.js";
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
import { computeJobContentHash } from "../utils/jobContentHash.js";
import {
  assertRequiredSelect,
  logCacheHitMetrics,
  logEfficiencyMetrics,
  logQueryMetrics,
} from "../utils/queryMetrics.js";
import { hashedCacheKey } from "../utils/cacheKey.js";
import { parseWorkdaySlug } from "../modules/atsDiscovery/atsUrlParser.js";
import {
  estimateJsonBytes,
  logUpdateReturnBytesEstimate,
  logUpdateReturnClassification,
  logUpdateReturnOptimized,
} from "../utils/dbPayloadDebug.js";
import {
  atsFinalizeChunkedEnabled,
  conditionalUpdateJobHashCacheHit,
  finalizeIngestChunked,
  jobHashCacheConditionalUpdateEnabled,
} from "../utils/jobWriteOptimization.js";

// Avoid back-to-back fetches when lastCrawledAt was just set.
const MIN_MS_SINCE_LAST_CRAWL_FOR_INGEST = Math.floor(2.5 * 60 * 1000);
const HASH_CACHE_NAMESPACE = "job_hash:atsWorker";
const HASH_CACHE_TTL_SECONDS = Math.max(3600, Math.min(21600, Number(process.env.JOB_HASH_CACHE_TTL_SECONDS ?? "10800") || 10800));
const skipNextIngestionByEndpoint = new Set<string>();
let atsHashCacheHits = 0;
let atsHashCacheMisses = 0;

const ATS_WORKER_IDLE_MS = 5 * 60 * 1000;
const ATS_HEARTBEAT_MS = 60_000;
/** Populated while `runAtsIngestJob` is past endpoint load (for heartbeat observability). */
let atsActiveJobMeta: { endpointId: string; atsType: string; startedAt: number } | null = null;
let atsLastJobActivityAt = Date.now();
let atsIsProcessingJob = false;
let atsLastIdleEventAt = 0;

const DEFAULT_ATS_FETCH_TIMEOUT_MS = 600_000;

const PROVIDER_TIMEOUT_MS: Record<string, number> = {
  workday: Math.max(30_000, Math.min(300_000, Number(process.env.ATS_WORKDAY_FETCH_TIMEOUT_MS ?? "120000") || 120_000)),
  greenhouse: 60_000,
  lever: 60_000,
  ashby: 60_000,
  bamboohr: 60_000,
  teamtailor: 60_000,
  rippling: 60_000,
  jobvite: 60_000,
  smartrecruiters: 60_000,
  workable: 60_000,
};

const PROVIDER_MAX_CONCURRENT: Record<string, number> = {
  workday: Math.max(1, Math.min(2, Number(process.env.ATS_WORKDAY_MAX_CONCURRENT ?? "1") || 1)),
};

const providerActiveCounts = new Map<string, number>();

function acquireProviderSlot(atsType: string): boolean {
  const max = PROVIDER_MAX_CONCURRENT[atsType];
  if (max == null) return true;
  const current = providerActiveCounts.get(atsType) ?? 0;
  if (current >= max) return false;
  providerActiveCounts.set(atsType, current + 1);
  return true;
}

function releaseProviderSlot(atsType: string): void {
  const max = PROVIDER_MAX_CONCURRENT[atsType];
  if (max == null) return;
  const current = providerActiveCounts.get(atsType) ?? 0;
  providerActiveCounts.set(atsType, Math.max(0, current - 1));
}

/**
 * Hard cap on `createAtsCrawlerStandard(...).fetchJobs` (fetch + normalize in adapter).
 * Uses `UnrecoverableError` on expiry so BullMQ does not retry the same hung fetch (avoids retry storms).
 * Set `ATS_ENDPOINT_FETCH_TIMEOUT_MS=0` to disable (not recommended in production).
 * Provider-specific timeouts via PROVIDER_TIMEOUT_MS (Workday default: 120s).
 */
function atsEndpointFetchTimeoutMs(atsType?: string): number {
  if (atsType && PROVIDER_TIMEOUT_MS[atsType] != null) {
    return PROVIDER_TIMEOUT_MS[atsType];
  }
  const raw = process.env.ATS_ENDPOINT_FETCH_TIMEOUT_MS?.trim();
  if (raw === "0") return 0;
  const n = Number(raw ?? String(DEFAULT_ATS_FETCH_TIMEOUT_MS));
  if (!Number.isFinite(n)) return DEFAULT_ATS_FETCH_TIMEOUT_MS;
  return Math.max(30_000, Math.min(3_600_000, Math.floor(n)));
}

function heartbeatActiveWarnMs(): number {
  const n = Number(process.env.ATS_HEARTBEAT_ACTIVE_WARN_MS ?? "300000");
  if (!Number.isFinite(n)) return 300_000;
  return Math.max(60_000, Math.min(3_600_000, Math.floor(n)));
}

function heartbeatQueueWaitWarn(): number {
  const n = Number(process.env.ATS_HEARTBEAT_QUEUE_WAIT_WARN ?? "40");
  if (!Number.isFinite(n)) return 40;
  return Math.max(5, Math.min(10_000, Math.floor(n)));
}

function processingLookbackDays(): number {
  return Math.max(1, Number(process.env.PROCESSING_LOOKBACK_DAYS ?? "7") || 7);
}

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
  if (err instanceof UnrecoverableError) return "crawler_error";
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

function titleCaseWords(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function slugToHumanLabel(value: string): string {
  return titleCaseWords(value.replace(/[._-]+/g, " ").trim());
}

function fallbackCompanyNameFromEndpoint(type: string, slug: string): string {
  if (type === "workday") {
    const parsed = parseWorkdaySlug(slug);
    if (parsed?.tenant?.trim()) {
      return slugToHumanLabel(parsed.tenant);
    }
    if (parsed?.host?.trim()) {
      const first = parsed.host.split(".")[0]?.trim();
      if (first) return slugToHumanLabel(first);
    }
  }
  const base = slug.split("__")[0]?.trim() || slug;
  return slugToHumanLabel(base).slice(0, 80) || `${type}:${slug.slice(0, 48)}`;
}

async function start(): Promise<void> {
  logUpdateReturnClassification({
    location: "atsEndpoint.worker.finalize.updateMany",
    classification: "NO_RETURN_NEEDED",
  });
  logUpdateReturnOptimized({
    location: "atsEndpoint.worker.finalize.updateMany",
    strategy: "updateMany",
  });
  loadRootEnv();
  assertWorkerProcessEnv();
  startWorkerHeartbeat("ingest-ats-endpoint");

  const jobRepository = createJobRepository(prisma);
  const companyService = new CompanyService(
    createCompanyRepository(prisma),
    jobRepository,
  );
  const jobService = new JobService(jobRepository);
  const endpointService = createAtsEndpointService(prisma);
  const redis = getIoredis();

  const atsIngestQueue = getIngestAtsEndpointQueue();
  getCompanyScoreQueue();

  const parsePoolConcurrency = clampPoolSize("ATS_PARSE_CONCURRENCY", "3", 4);
  const ingestPoolConcurrencyRaw = clampPoolSize("ATS_POOL_INGEST_CONCURRENCY", "3", 4);
  const ingestPoolConcurrency = Math.min(ingestPoolConcurrencyRaw, parsePoolConcurrency);
  const parseChunkSize = Math.max(10, Math.min(500, Number(process.env.ATS_PARSE_CHUNK_SIZE ?? "100") || 100));
  /** Default 1: a single long-lived ingest blocks the whole queue; see incident runbooks. Ops may set 2 when VPS has headroom. */
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
      atsFetchTimeoutMs: atsEndpointFetchTimeoutMs(undefined),
      atsWorkdayTimeoutMs: PROVIDER_TIMEOUT_MS["workday"],
      jobWorkerConc: Number(process.env.WORKER_CONCURRENCY ?? "5"),
    },
    "worker_concurrency_config",
  );

  async function runAtsIngestJob(job: Job): Promise<void> {
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
      select: {
        id: true,
        type: true,
        slug: true,
        baseUrl: true,
        metadata: true,
        companyId: true,
        companyName: true,
        lastCrawledAt: true,
        source: true,
      },
    });
    assertRequiredSelect("AtsEndpoint", "atsEndpoint.worker.findUnique", {
      id: true,
      type: true,
      slug: true,
      baseUrl: true,
      metadata: true,
      companyId: true,
      companyName: true,
      lastCrawledAt: true,
      source: true,
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
    if (skipNextIngestionByEndpoint.has(endpointId)) {
      skipNextIngestionByEndpoint.delete(endpointId);
      logger.warn(
        { event: "ats_ingestion_skipped_low_efficiency_backpressure", endpointId },
        "ats_ingestion_skipped_low_efficiency_backpressure",
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
    atsActiveJobMeta = { endpointId, atsType: endpointRow.type, startedAt: Date.now() };

    const ingestCompany = await companyService.resolveCompanyForAtsIngest({
      preferredCompanyId: endpointRow.companyId ?? undefined,
      companyName:
        endpointRow.companyName?.trim() ||
        fallbackCompanyNameFromEndpoint(endpointRow.type, endpointRow.slug),
      atsType: endpointRow.type,
      atsBoardToken: endpointRow.slug,
    });
    const resolvedCompanyId = ingestCompany.companyId;

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

    const displayName = companyDisplayName(company.name, company.domain);
    if (
      ingestCompany.switchedCanonical ||
      endpointRow.companyId !== resolvedCompanyId ||
      endpointRow.companyName?.trim() !== displayName
    ) {
      await prisma.atsEndpoint.update({
        where: { id: endpointId },
        data: { companyId: resolvedCompanyId, companyName: displayName },
      });
    }

    const atsType = endpointRow.type as AtsType;
    const endpointForAdapter = {
      id: endpointRow.id,
      type: atsType,
      slug: endpointRow.slug,
      baseUrl: endpointRow.baseUrl,
      metadata: endpointRow.metadata,
      companyId: resolvedCompanyId,
      companyName: displayName,
    };

    if (!acquireProviderSlot(atsType)) {
      logger.info(
        { event: "ats_ingestion_skipped_provider_concurrency", ...logBase, atsType },
        "ats_ingestion_skipped_provider_concurrency",
      );
      return;
    }

    let normalizedJobs;
    const fetchTimeoutMs = atsEndpointFetchTimeoutMs(atsType);
    const fetchStartedAt = Date.now();
    try {
      const standard = createAtsCrawlerStandard(atsType);
      const fetchPromise = (async () => {
        await throttleApiCall();
        return standard.fetchJobs(endpointForAdapter);
      })();

      if (fetchTimeoutMs <= 0) {
        normalizedJobs = await fetchPromise;
      } else {
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(
              new UnrecoverableError(
                `ats_endpoint_fetch_timeout after ${fetchTimeoutMs}ms endpoint=${endpointId} type=${atsType}`,
              ),
            );
          }, fetchTimeoutMs);
        });
        try {
          normalizedJobs = await Promise.race([fetchPromise, timeoutPromise]);
        } finally {
          if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        }
      }
    } catch (err) {
      releaseProviderSlot(atsType);
      const isTimeout = err instanceof UnrecoverableError && err.message.startsWith("ats_endpoint_fetch_timeout");
      if (isTimeout) {
        logger.error(
          {
            event: "ats_endpoint_fetch_timeout",
            ...logBase,
            atsType,
            timeoutMs: fetchTimeoutMs,
            durationMs: Date.now() - fetchStartedAt,
            err: (err as Error).message,
          },
          "ats_endpoint_fetch_timeout",
        );
      }
      const errorKind = classifyAtsIngestError(err);
      logger.error(
        {
          event: "ats_ingestion_failed",
          ...logBase,
          errorKind,
          err,
          isTimeout,
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

    releaseProviderSlot(atsType);

    const companyDomain = extractCompanyDomain(
      company.careersUrl,
      resolvedCompanyId,
    );
    const seenAt = new Date();
    const sourceUrls = normalizedJobs.map((j) => j.sourceUrl);
    const touchedRows = await jobService.touchLastSeenBySourceUrls(sourceUrls, seenAt);

    let failures = 0;
    let jobsInserted = 0;
    let duplicatesSkipped = 0;
    let unchangedSkipped = 0;
    let updatedRows = 0;

    type IngestRow = {
      canonicalId: string;
      inserted: boolean;
      sourceUrl: string;
      newContentHash: string;
      shouldSkipParse: boolean;
    };

    const ingestResults = await asyncPool(
      normalizedJobs,
      ingestPoolConcurrency,
      async (normalizedJob: NormalizedJob): Promise<IngestRow | null> => {
        try {
          const newContentHash = computeJobContentHash({
            title: normalizedJob.title,
            description: normalizedJob.description,
            applyUrl: normalizedJob.applyUrl ?? normalizedJob.sourceUrl,
          });
          const hashCacheKey = hashedCacheKey(HASH_CACHE_NAMESPACE, normalizedJob.sourceUrl);
          try {
            const cachedHash = await redis.get(hashCacheKey);
            if (cachedHash === newContentHash) {
              atsHashCacheHits += 1;
              if ((atsHashCacheHits + atsHashCacheMisses) % 100 === 0) {
                logCacheHitMetrics({
                  name: "atsEndpoint.worker.hashCache",
                  hits: atsHashCacheHits,
                  misses: atsHashCacheMisses,
                });
              }
              await redis.set(hashCacheKey, newContentHash, "EX", HASH_CACHE_TTL_SECONDS);
              if (jobHashCacheConditionalUpdateEnabled()) {
                await conditionalUpdateJobHashCacheHit(prisma, {
                  sourceUrl: normalizedJob.sourceUrl,
                  contentHash: newContentHash,
                  processedAt: seenAt,
                });
              } else {
                await prisma.job.updateMany({
                  where: { sourceUrl: normalizedJob.sourceUrl },
                  data: { lastProcessedAt: seenAt, contentHash: newContentHash },
                });
              }
              unchangedSkipped += 1;
              return null;
            }
            atsHashCacheMisses += 1;
            if ((atsHashCacheHits + atsHashCacheMisses) % 100 === 0) {
              logCacheHitMetrics({
                name: "atsEndpoint.worker.hashCache",
                hits: atsHashCacheHits,
                misses: atsHashCacheMisses,
              });
            }
          } catch (err) {
            logger.warn({ event: "ats_job_hash_cache_read_failed", sourceUrl: normalizedJob.sourceUrl, err }, "ats_job_hash_cache_read_failed");
          }
          const { inserted, canonical } = await jobService.ingestDeduplicated(
            {
              ...normalizedJob,
              companyDomain,
            },
            { batchTouchAtMs: seenAt.getTime() },
          );
          const shouldSkipParse = canonical.contentHash === newContentHash;
          if (inserted) jobsInserted += 1;
          else if (shouldSkipParse) unchangedSkipped += 1;
          else duplicatesSkipped += 1;
          try {
            await redis.set(hashCacheKey, newContentHash, "EX", HASH_CACHE_TTL_SECONDS);
          } catch (err) {
            logger.warn({ event: "ats_job_hash_cache_write_failed", sourceUrl: normalizedJob.sourceUrl, err }, "ats_job_hash_cache_write_failed");
          }
          return {
            canonicalId: canonical.id,
            inserted,
            sourceUrl: normalizedJob.sourceUrl,
            newContentHash,
            shouldSkipParse,
          };
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
    logQueryMetrics("atsEndpoint.worker.flatIngest", flatIngest, 450);
    const lookbackSince = new Date(Date.now() - processingLookbackDays() * 24 * 60 * 60 * 1000);
    const canonicalMeta = flatIngest.length
      ? await prisma.job.findMany({
          where: { id: { in: flatIngest.map((r) => r.canonicalId) } },
          select: { id: true, lastSeenAt: true, lastProcessedAt: true },
        })
      : [];
    assertRequiredSelect("Job", "atsEndpoint.worker.canonicalMeta.findMany", {
      id: true,
      lastSeenAt: true,
      lastProcessedAt: true,
    });
    const canonicalMetaMap = new Map(canonicalMeta.map((row) => [row.id, row]));
    const parseCandidates = flatIngest.filter((row) => {
      if (row.shouldSkipParse) return false;
      const meta = canonicalMetaMap.get(row.canonicalId);
      if (!meta) return false;
      if (meta.lastSeenAt < lookbackSince) return false;
      return meta.lastProcessedAt == null || meta.lastSeenAt > meta.lastProcessedAt;
    });

    for (const chunk of chunkArray(parseCandidates, parseChunkSize)) {
      await asyncPool(chunk, parsePoolConcurrency, async (row) => {
        try {
          await enrichCanonicalJobParsedDescription(
            prisma,
            jobRepository,
            row.canonicalId,
            row.inserted,
          );
          updatedRows += 1;
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
    const processedAt = new Date();
    const finalizeByCanonical = new Map<string, { canonicalId: string; newContentHash: string }>();
    for (const row of flatIngest) {
      finalizeByCanonical.set(row.canonicalId, {
        canonicalId: row.canonicalId,
        newContentHash: row.newContentHash,
      });
    }
    const finalizeRows = [...finalizeByCanonical.values()];
    if (finalizeRows.length > 0) {
      if (atsFinalizeChunkedEnabled()) {
        await finalizeIngestChunked(prisma, finalizeRows, processedAt);
        for (const row of finalizeRows) {
          logUpdateReturnBytesEstimate({
            location: "atsEndpoint.worker.finalize.chunked",
            estimatedBytes: estimateJsonBytes({
              id: row.canonicalId,
              lastProcessedAt: processedAt,
              contentHash: row.newContentHash,
            }),
            rows: 1,
          });
        }
      } else {
        for (const row of finalizeRows) {
          const updateRes = await prisma.job.updateMany({
            where: { id: row.canonicalId },
            data: { lastProcessedAt: processedAt, contentHash: row.newContentHash },
          });
          if (updateRes.count === 0) {
            throw new Error(`atsEndpoint.worker.finalize.missing_row:${row.canonicalId}`);
          }
          logUpdateReturnBytesEstimate({
            location: "atsEndpoint.worker.finalize.perCanonical",
            estimatedBytes: estimateJsonBytes({
              id: row.canonicalId,
              lastProcessedAt: processedAt,
              contentHash: row.newContentHash,
            }),
            rows: 1,
          });
        }
      }
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
        unchangedSkipped,
        touchedRows,
      },
      "ats_ingestion_summary",
    );
    const efficiency = logEfficiencyMetrics({
      name: "atsEndpoint.worker",
      readRows: normalizedJobs.length,
      updatedRows,
      skippedRows: unchangedSkipped + duplicatesSkipped,
    });
    if (efficiency < 0.05) {
      skipNextIngestionByEndpoint.add(endpointId);
    }

    const crawlCompletedAt = new Date();
    await prisma.atsEndpoint.update({
      where: { id: endpointId },
      data: { lastCrawledAt: crawlCompletedAt },
    });

    const totalFetched = normalizedJobs.length;
    const failureRatio = totalFetched > 0 ? failures / totalFetched : 0;
    if (failures === 0 || (totalFetched > 0 && failureRatio < 0.5)) {
      await endpointService.markSuccess(endpointId);
      if (failures > 0) {
        logger.warn(
          {
            event: "endpoint_job_partial_failures",
            endpointId,
            atsType,
            totalFetched,
            failures,
            failureRatio: Math.round(failureRatio * 100) / 100,
          },
          "endpoint_job_partial_failures",
        );
      }
    } else {
      logger.error(
        {
          event: "endpoint_fetch_failures",
          endpointId,
          atsType,
          totalFetched,
          failures,
          failureRatio: Math.round(failureRatio * 100) / 100,
        },
        "endpoint_fetch_failures",
      );
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

  }

  const worker = new Worker(
    INGEST_ATS_ENDPOINT_QUEUE_NAME,
    async (job) => {
      const jobStartedAt = Date.now();
      const jobIdStr = String(job.id ?? "");
      atsIsProcessingJob = true;
      let atsJobSuccess = true;
      logger.info(
        {
          event: "ats_worker_job_start",
          jobId: jobIdStr,
          name: job.name,
          timestamp: new Date().toISOString(),
        },
        "ats_worker_job_start",
      );
      try {
        await runAtsIngestJob(job);
      } catch (e) {
        atsJobSuccess = false;
        logger.error(
          {
            event: "ats_worker_job_error",
            jobId: jobIdStr,
            durationMs: Date.now() - jobStartedAt,
            err: e,
          },
          "ats_worker_job_error",
        );
        throw e;
      } finally {
        atsActiveJobMeta = null;
        atsIsProcessingJob = false;
        atsLastJobActivityAt = Date.now();
        if (atsJobSuccess) {
          logger.info(
            {
              event: "ats_worker_job_done",
              jobId: jobIdStr,
              durationMs: Date.now() - jobStartedAt,
            },
            "ats_worker_job_done",
          );
        }
      }
    },
    { connection: getRedisConnection(), concurrency: bullConcurrency },
  );

  const atsHeartbeat = setInterval(() => {
    void (async () => {
      let jobCounts: Awaited<ReturnType<typeof atsIngestQueue.getJobCounts>> | undefined;
      try {
        jobCounts = await atsIngestQueue.getJobCounts();
      } catch (err) {
        logger.warn({ event: "ats_worker_heartbeat_queue_counts_failed", err }, "ats_worker_heartbeat_queue_counts_failed");
      }
      const now = Date.now();
      const mem = process.memoryUsage();
      const activeMeta = atsActiveJobMeta;
      const activeDurationMs =
        activeMeta !== null && atsIsProcessingJob ? now - activeMeta.startedAt : null;
      const slowThresholdMs = heartbeatActiveWarnMs();
      const waitWarn = heartbeatQueueWaitWarn();
      const waiting = jobCounts?.waiting ?? 0;
      const activeCount = jobCounts?.active ?? 0;
      const idleMs = atsIsProcessingJob ? 0 : now - atsLastJobActivityAt;
      if (!atsIsProcessingJob && idleMs >= ATS_WORKER_IDLE_MS) {
        if (now - atsLastIdleEventAt >= ATS_WORKER_IDLE_MS) {
          atsLastIdleEventAt = now;
          logger.info(
            {
              event: "ats_worker_idle",
              timestamp: new Date().toISOString(),
              pid: process.pid,
              idleMs,
              lastJobActivityAt: new Date(atsLastJobActivityAt).toISOString(),
            },
            "ats_worker_idle",
          );
        }
      } else {
        atsLastIdleEventAt = 0;
      }
      if (
        activeMeta &&
        activeDurationMs !== null &&
        activeDurationMs > slowThresholdMs &&
        waiting >= waitWarn
      ) {
        logger.warn(
          {
            event: "ats_worker_queue_starvation_risk",
            timestamp: new Date().toISOString(),
            activeEndpointId: activeMeta.endpointId,
            activeAtsType: activeMeta.atsType,
            activeDurationMs,
            queueWaiting: waiting,
            queueActive: activeCount,
            slowThresholdMs,
            waitWarnThreshold: waitWarn,
          },
          "ats_worker_queue_starvation_risk",
        );
      } else if (activeMeta && activeDurationMs !== null && activeDurationMs > slowThresholdMs) {
        logger.warn(
          {
            event: "ats_worker_active_job_slow",
            timestamp: new Date().toISOString(),
            activeEndpointId: activeMeta.endpointId,
            activeAtsType: activeMeta.atsType,
            activeDurationMs,
            queueWaiting: waiting,
            queueActive: activeCount,
            slowThresholdMs,
          },
          "ats_worker_active_job_slow",
        );
      }

      logger.info(
        {
          event: "ats_worker_heartbeat",
          timestamp: new Date().toISOString(),
          pid: process.pid,
          memoryUsage: {
            rss: mem.rss,
            heapTotal: mem.heapTotal,
            heapUsed: mem.heapUsed,
            external: mem.external,
          },
          isProcessingJob: atsIsProcessingJob,
          activeEndpointId: activeMeta?.endpointId ?? null,
          activeAtsType: activeMeta?.atsType ?? null,
          activeDurationMs,
          queueWaiting: jobCounts?.waiting,
          queueActive: jobCounts?.active,
          queueDepth: jobCounts !== undefined ? jobCounts.waiting + jobCounts.delayed : undefined,
          jobCounts,
        },
        "ats_worker_heartbeat",
      );
    })();
  }, ATS_HEARTBEAT_MS);
  atsHeartbeat.unref?.();

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
