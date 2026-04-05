import { createHash } from "node:crypto";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { loadRootEnv } from "../../infrastructure/env/loadEnv.js";
import { prisma } from "../../infrastructure/db/prisma.js";
import { logger } from "../../utils/logger.js";
import {
  RUN_SERP_BATCH_JOB,
  SERP_QUEUE_NAME,
  getSerpQueue,
  closeSerpQueue,
} from "../../queues/serp.queue.js";
import { extractDomain, fetchSerpResults } from "./serp.client.js";
import { isSerpDebugMode, serpQueryGenerator } from "./serpQueryGenerator.js";
import { extractCompanySlug, getAtsSignalScore, inferAtsType } from "./serpEnrichment.js";
import { delay } from "../../utils/common.js";
import type { SerpApiResult } from "./serp.client.js";
import { getRedisConnection } from "../../queues/job.queue.js";
import { assertWorkerProcessEnv } from "../../infrastructure/env/validateWorkerEnv.js";
import { registerWorkerShutdown } from "../../utils/workerShutdown.js";
import { recordSerpQueryPipelineTotals } from "../../services/atsPipelineCounters.service.js";

const MAX_QUERIES_PER_RUN = 8;
const MAX_QUERIES_DEBUG = 3;
const QUERY_DELAY_MS = 800;

/** Per-query key `serp:skip_query:<sha256>` with TTL; avoids re-fetching when results are mostly already in DB. */
const SERP_SKIP_QUERY_KEY_PREFIX = "serp:skip_query:";
const DEFAULT_DEDUP_SKIP_RATIO = 0.8;
const DEFAULT_SKIP_QUERY_TTL_SECONDS = 604800; // 7 days

function getSerpRedis(): Redis {
  return getRedisConnection() as unknown as Redis;
}

function serpQuerySkipRedisKey(query: string): string {
  const hash = createHash("sha256").update(query, "utf8").digest("hex");
  return `${SERP_SKIP_QUERY_KEY_PREFIX}${hash}`;
}

function getDedupSkipRatioThreshold(): number {
  const raw = process.env.SERP_SKIP_QUERY_DEDUP_RATIO?.trim();
  if (raw === undefined || raw === "") return DEFAULT_DEDUP_SKIP_RATIO;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : DEFAULT_DEDUP_SKIP_RATIO;
}

function getSkipQueryTtlSeconds(): number {
  const raw = process.env.SERP_SKIP_QUERY_TTL_SECONDS?.trim();
  if (raw === undefined || raw === "") return DEFAULT_SKIP_QUERY_TTL_SECONDS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SKIP_QUERY_TTL_SECONDS;
}

async function isQuerySkippedForHighDedup(redis: Redis, query: string): Promise<boolean> {
  const key = serpQuerySkipRedisKey(query);
  const v = await redis.get(key);
  return v != null;
}

async function markQuerySkipFutureRunsForHighDedup(
  redis: Redis,
  query: string,
  ratio: number,
  deduped: number,
  totalResults: number,
): Promise<void> {
  const key = serpQuerySkipRedisKey(query);
  const ttlSeconds = getSkipQueryTtlSeconds();
  await redis.set(key, "1", "EX", ttlSeconds);
  logger.info(
    {
      event: "serp_query_skip_future_runs",
      query,
      dedupRatio: ratio,
      deduped,
      totalResults,
      threshold: getDedupSkipRatioThreshold(),
      redisKey: key,
      ttlSeconds,
    },
    "serp_query_skip_future_runs",
  );
}

type SerpFilterReasonBuckets = {
  deep_path: number;
  job_detail: number;
  invalid_url: number;
  unsupported_ats: number;
  invalid_slug: number;
  in_batch_duplicate: number;
  other: number;
};

function emptyFilterBuckets(): SerpFilterReasonBuckets {
  return {
    deep_path: 0,
    job_detail: 0,
    invalid_url: 0,
    unsupported_ats: 0,
    invalid_slug: 0,
    in_batch_duplicate: 0,
    other: 0,
  };
}

function bucketSerpFilterReason(reason: string): keyof SerpFilterReasonBuckets {
  if (reason === "invalid_url" || reason === "non_http" || reason === "has_query_params") {
    return "invalid_url";
  }
  if (reason === "path_too_deep" || reason === "workday_deep_path") return "deep_path";
  if (
    reason === "path_contains_job_segment" ||
    reason === "jobs_followed_by_id" ||
    reason === "positions_followed_by_id" ||
    reason === "workday_job_detail" ||
    reason.startsWith("workday_")
  ) {
    return "job_detail";
  }
  if (
    reason === "not_whitelisted_ats_host" ||
    reason === "greenhouse_not_board_root" ||
    reason === "lever_not_board_root"
  ) {
    return "unsupported_ats";
  }
  return "other";
}

function normalizeRank(idx: number): number {
  return idx + 1;
}

function uniqueByUrl(urls: SerpApiResult[]): SerpApiResult[] {
  const seen = new Set<string>();
  const out: SerpApiResult[] = [];
  for (const r of urls) {
    const key = r.url;
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function parseUrlSafe(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function countPathSegments(pathname: string): number {
  const trimmed = pathname.replace(/^\/+|\/+$/g, "");
  if (!trimmed) return 0;
  return trimmed.split("/").filter(Boolean).length;
}

function isDigitsOnly(s: string): boolean {
  return /^[0-9]+$/.test(s);
}

function looksLikeJobIdSegment(s: string): boolean {
  // Intentionally simple heuristic: many ATS job pages carry numeric IDs.
  if (!s) return false;
  if (isDigitsOnly(s)) return true;
  if (/^\d{4,}$/.test(s)) return true;
  if (/^\d{3,}-\d{3,}$/.test(s)) return true;
  return false;
}

function getFilterReason(url: string): string | null {
  const u = parseUrlSafe(url);
  if (!u) return "invalid_url";
  if (u.protocol !== "http:" && u.protocol !== "https:") return "non_http";

  if (u.search && u.search.length > 0) return "has_query_params";

  const host = u.hostname.toLowerCase();
  const path = u.pathname || "/";
  const segs = path.split("/").filter(Boolean);
  const lowerPath = path.toLowerCase();

  if (host.endsWith(".myworkdayjobs.com")) {
    if (segs.length > 2) return "workday_deep_path";
    if (lowerPath.includes("job-details")) return "workday_job_detail";
    if (lowerPath.includes("posting")) return "workday_job_detail";
    if (lowerPath.includes("/req") || lowerPath.includes("req/")) return "workday_job_detail";
    if (lowerPath.includes("/job/") || lowerPath.endsWith("/job")) return "workday_job_detail";
    for (const s of segs) {
      if (s.toLowerCase() === "job") return "workday_job_detail";
    }
    return null;
  }

  if (countPathSegments(path) > 3) return "path_too_deep";

  if (lowerPath.includes("/job/")) return "path_contains_job_segment";

  const jobsIdx = segs.findIndex((s) => s.toLowerCase() === "jobs");
  if (jobsIdx >= 0) {
    const next = segs[jobsIdx + 1] ?? "";
    if (looksLikeJobIdSegment(next)) return "jobs_followed_by_id";
  }

  const posIdx = segs.findIndex((s) => s.toLowerCase() === "positions");
  if (posIdx >= 0) {
    const next = segs[posIdx + 1] ?? "";
    if (looksLikeJobIdSegment(next)) return "positions_followed_by_id";
  }

  if (host === "boards.greenhouse.io") {
    if (segs.length === 1) return null;
    return "greenhouse_not_board_root";
  }

  if (host === "jobs.lever.co") {
    if (segs.length === 1) return null;
    return "lever_not_board_root";
  }

  if (host === "jobs.ashbyhq.com") {
    return null;
  }

  if (host === "jobs.jobvite.com") {
    return null;
  }

  if (host === "icims.com") {
    return null;
  }

  return "not_whitelisted_ats_host";
}

export function isHighSignalAtsUrl(url: string): boolean {
  return getFilterReason(url) === null;
}

function logSerpQueryAnalysis(args: {
  query: string;
  batchId: string;
  totalResults: number;
  filteredOut: number;
  filterReasons: SerpFilterReasonBuckets;
  highSignal: number;
  deduped: number;
  inserted: number;
  fetchFailed?: boolean;
  dedupRatio?: number;
  queryMarkedSkipFuture?: boolean;
}): void {
  recordSerpQueryPipelineTotals({
    totalResults: args.totalResults,
    highSignal: args.highSignal,
    inserted: args.inserted,
    deduped: args.deduped,
  });
  const dedupRatio =
    args.dedupRatio !== undefined
      ? args.dedupRatio
      : args.totalResults > 0
        ? args.deduped / args.totalResults
        : 0;
  logger.info(
    {
      event: "serp_query_efficiency",
      query: args.query,
      totalResults: args.totalResults,
      highSignal: args.highSignal,
      inserted: args.inserted,
      dedupRatio,
    },
    "serp_query_efficiency",
  );
  logger.info(
    {
      event: "serp_query_analysis",
      query: args.query,
      batchId: args.batchId,
      totalResults: args.totalResults,
      total_results_fetched: args.totalResults,
      filteredOut: args.filteredOut,
      filtered_out_count: args.filteredOut,
      filterReasons: args.filterReasons,
      highSignal: args.highSignal,
      high_signal_count: args.highSignal,
      deduped: args.deduped,
      deduped_count: args.deduped,
      dedupRatio: args.dedupRatio,
      inserted: args.inserted,
      final_inserted_count: args.inserted,
      fetchFailed: args.fetchFailed ?? false,
      queryMarkedSkipFuture: args.queryMarkedSkipFuture ?? false,
    },
    "serp_query_analysis",
  );
}

async function runSerpBatch(): Promise<void> {
  const maxQueriesPerRun = isSerpDebugMode() ? MAX_QUERIES_DEBUG : MAX_QUERIES_PER_RUN;
  const allQueries = serpQueryGenerator();
  let queriesExecuted = 0;

  for (const query of allQueries) {
    if (queriesExecuted >= maxQueriesPerRun) {
      logger.warn(
        { event: "serp_max_queries_per_run_reached", maxQueriesPerRun, queriesExecuted },
        "serp_max_queries_per_run_reached",
      );
      break;
    }

    try {
      const redis = getSerpRedis();
      if (await isQuerySkippedForHighDedup(redis, query)) {
        logger.info(
          {
            event: "serp_query_skipped_high_dedup_cooldown",
            query,
            redisKey: serpQuerySkipRedisKey(query),
          },
          "serp_query_skipped_high_dedup_cooldown",
        );
        continue;
      }
    } catch (err) {
      logger.warn(
        { event: "serp_dedup_skip_redis_unavailable", query, err },
        "serp_dedup_skip_redis_unavailable",
      );
    }

    queriesExecuted += 1;

    const batch = await prisma.serpBatch.create({
      data: {
        query,
        source: "google",
        status: "pending",
      },
      select: { id: true },
    });

    logger.info(
      {
        event: "serp_batch_started",
        query,
        batchId: batch.id,
        serpDebug: isSerpDebugMode(),
        maxQueriesPerRun,
      },
      "serp_batch_started",
    );

    const filterReasons = emptyFilterBuckets();
    let fetchFailed = false;

    try {
      const results = await fetchSerpResults(query);
      const cleaned: SerpApiResult[] = uniqueByUrl(
        (results ?? [])
          .filter((r) => typeof r.url === "string" && r.url.startsWith("http"))
          .map((r, idx) => ({
            ...r,
            url: r.url,
            title: r.title,
            snippet: r.snippet,
            rank: typeof r.rank === "number" ? r.rank : normalizeRank(idx),
          })),
      );

      const totalResults = cleaned.length;
      const inMemorySeen = new Set<string>();
      const highSignal: Array<{
        url: string;
        domain: string;
        atsType: string | null;
        slug: string | null;
        score: number;
        title: string | null;
        snippet: string | null;
        rank: number | null;
      }> = [];

      for (const r of cleaned) {
        if (inMemorySeen.has(r.url)) {
          filterReasons.in_batch_duplicate += 1;
          if (isSerpDebugMode()) {
            logger.info(
              { event: "serp_url_filtered_out", url: r.url, reason: "in_batch_duplicate", query },
              "serp_url_filtered_out",
            );
          }
          continue;
        }
        inMemorySeen.add(r.url);

        const reason = getFilterReason(r.url);
        if (reason) {
          const b = bucketSerpFilterReason(reason);
          filterReasons[b] += 1;
          if (isSerpDebugMode()) {
            logger.info({ event: "serp_url_filtered_out", url: r.url, reason, query }, "serp_url_filtered_out");
          }
          continue;
        }

        const domain = extractDomain(r.url);
        const atsType = inferAtsType(domain);
        const slug = extractCompanySlug(r.url, atsType);
        if (slug === null) {
          filterReasons.invalid_slug += 1;
          if (isSerpDebugMode()) {
            logger.info(
              { event: "serp_slug_extraction_failed", url: r.url, atsType, query },
              "serp_slug_extraction_failed",
            );
          }
        }
        const score = getAtsSignalScore(atsType);
        if (isSerpDebugMode()) {
          logger.info(
            {
              event: "serp_high_signal_url_detected",
              url: r.url,
              domain,
              atsType,
              slug,
              score,
              query,
            },
            "serp_high_signal_url_detected",
          );
        }

        highSignal.push({
          url: r.url,
          domain,
          atsType,
          slug,
          score,
          title: r.title ?? null,
          snippet: r.snippet ?? null,
          rank: r.rank ?? null,
        });
      }

      const filteredOut = cleaned.length - highSignal.length;

      const existing = await prisma.serpResult.findMany({
        where: { url: { in: highSignal.map((x) => x.url) } },
        select: { url: true },
      });
      const existingSet = new Set(existing.map((x) => x.url));
      for (const row of highSignal) {
        if (existingSet.has(row.url)) {
          logger.info(
            {
              event: "serp_duplicate_detected",
              url: row.url,
              query,
              batchId: batch.id,
            },
            "serp_duplicate_detected",
          );
        }
      }
      const deduped = highSignal.filter((x) => existingSet.has(x.url)).length;
      const toInsert = highSignal.filter((x) => !existingSet.has(x.url));

      if (toInsert.length > 0) {
        await prisma.serpResult.createMany({
          data: toInsert.map((r) => ({
            batchId: batch.id,
            url: r.url,
            domain: r.domain,
            atsType: r.atsType,
            slug: r.slug,
            score: r.score,
            title: r.title,
            snippet: r.snippet,
            rank: r.rank,
          })),
        });
      }

      const dedupRatio = totalResults > 0 ? deduped / totalResults : 0;
      const skipThreshold = getDedupSkipRatioThreshold();
      let queryMarkedSkipFuture = false;
      if (totalResults > 0 && dedupRatio > skipThreshold) {
        try {
          await markQuerySkipFutureRunsForHighDedup(getSerpRedis(), query, dedupRatio, deduped, totalResults);
          queryMarkedSkipFuture = true;
        } catch (err) {
          logger.warn(
            { event: "serp_dedup_skip_mark_failed", query, err },
            "serp_dedup_skip_mark_failed",
          );
        }
      }

      logSerpQueryAnalysis({
        query,
        batchId: batch.id,
        totalResults,
        filteredOut,
        filterReasons: { ...filterReasons },
        highSignal: highSignal.length,
        deduped,
        inserted: toInsert.length,
        dedupRatio,
        queryMarkedSkipFuture,
      });

      logger.info(
        {
          event: "serp_results_count",
          query,
          batchId: batch.id,
          resultCount: toInsert.length,
        },
        "serp_results_count",
      );

      await prisma.serpBatch.update({
        where: { id: batch.id },
        data: { status: "completed" },
      });

      logger.info(
        {
          event: "serp_batch_completed",
          query,
          batchId: batch.id,
          resultCount: toInsert.length,
        },
        "serp_batch_completed",
      );
    } catch (err) {
      fetchFailed = true;
      logger.error(
        {
          event: "serp_batch_failed",
          query,
          batchId: batch.id,
          resultCount: 0,
          err,
        },
        "serp_batch_failed",
      );
      logSerpQueryAnalysis({
        query,
        batchId: batch.id,
        totalResults: 0,
        filteredOut: 0,
        filterReasons: emptyFilterBuckets(),
        highSignal: 0,
        deduped: 0,
        inserted: 0,
        fetchFailed,
      });
      await prisma.serpBatch.update({
        where: { id: batch.id },
        data: { status: "failed" },
      });
    }

    await delay(QUERY_DELAY_MS);
  }
}

function isRunBatchPayload(data: unknown): data is Record<string, never> {
  return typeof data === "object" && data !== null;
}

async function start(): Promise<void> {
  loadRootEnv();
  assertWorkerProcessEnv();
  getSerpQueue();

  const worker = new Worker(
    SERP_QUEUE_NAME,
    async (job) => {
      if (job.name !== RUN_SERP_BATCH_JOB) {
        throw new Error(`Unknown SERP job name: ${job.name}`);
      }

      if (!isRunBatchPayload(job.data)) {
        throw new Error("Invalid run_serp_batch payload");
      }

      await runSerpBatch();
      return;
    },
    { connection: getRedisConnection(), concurrency: 1 },
  );

  worker.on("failed", (job, err) => {
    logger.error(
      { event: "serp_worker_job_failed", jobId: job?.id, err },
      "serp_worker_job_failed",
    );
  });

  logger.info({ event: "serp_worker_started" }, "serp_worker_started");

  registerWorkerShutdown({
    worker,
    closeQueues: [closeSerpQueue],
    prismaDisconnect: () => prisma.$disconnect(),
  });
}

void start().catch((err) => {
  logger.error({ event: "serp_worker_boot_failed", err }, "serp_worker_boot_failed");
  process.exitCode = 1;
});

