/**
 * Lightweight ingestion / queue observability for ops dashboards and alerting.
 * Avoids heavy parallel Prisma fan-out (see metricsSnapshot.service).
 */
import type { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { getRedisConnection, JOB_QUEUE_NAME } from "../queues/job.queue.js";
import { INGEST_ATS_ENDPOINT_QUEUE_NAME } from "../queues/ats-endpoint.queue.js";
import { DISCOVERY_QUEUE_NAME } from "../queues/discovery.queue.js";
import { DISCOVER_ATS_ENDPOINTS_QUEUE_NAME } from "../queues/atsDiscovery.queue.js";
import { SERP_QUEUE_NAME } from "../queues/serp.queue.js";
import { ENRICH_COMPANY_QUEUE_NAME } from "../queues/enrich-company.queue.js";
import { getCompanyDiscoveryMetrics } from "./companyDiscoveryMetrics.service.js";
import { readWorkerHeartbeats, type WorkerHeartbeatRow } from "./workerHeartbeat.service.js";

export type QueueDepthRow = {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  paused: number;
  oldestWaitingMs: number | null;
};

export type EndpointStalenessRow = {
  active_total: number;
  never_crawled: number;
  fresh_15m: number;
  older_1h: number;
  /** Active endpoints with null `lastCrawledAt` or last crawl older than 6 hours. */
  drift_gt_6h: number;
  /** Active endpoints with null `lastCrawledAt` or last crawl older than 24 hours. */
  drift_gt_24h: number;
  /** Histogram: active, `lastCrawledAt` not null, last crawl within 15m. */
  crawled_age_0_15m: number;
  /** Age in [15m, 1h). */
  crawled_age_15m_1h: number;
  /** Age in [1h, 6h). */
  crawled_age_1h_6h: number;
  /** Age in [6h, 24h). */
  crawled_age_6h_24h: number;
  /** Age ≥ 24h (still has a crawl stamp). */
  crawled_age_gt_24h: number;
  p50_age_min: number | null;
  p95_age_min: number | null;
  max_age_hours: number | null;
};

export type PrimaryLifecycleRow = {
  processing_primaries: number;
  ready_primaries: number;
  processing_no_parse: number;
  processing_parse_present: number;
  oldest_processing_minutes: number | null;
};

type PrimaryLifecycleSqlRow = {
  processing_primaries: bigint;
  ready_primaries: bigint;
  processing_no_parse: bigint;
  processing_parse_present: bigint;
  oldest_processing_minutes: number | null;
};

export type ProviderFreshnessRow = {
  type: string;
  active: number;
  fresh_1h: number;
  fresh_6h: number;
  stale_24h_plus: number;
};

export type ScoreTierRow = {
  hot: number;
  warm: number;
  cold: number;
};

export type IngestionObservabilitySnapshot = {
  generatedAt: string;
  queues: QueueDepthRow[];
  endpoints: EndpointStalenessRow | null;
  primaryJobs: PrimaryLifecycleRow | null;
  throughput1h: {
    jobsCreated: number | null;
    endpointCrawls: number | null;
    companiesCreated: number | null;
  };
  /** Jobs with usable parse still `processing` and quiet `updatedAt` — reconcile backlog signal. */
  reconcileStaleParsedProcessing: number | null;
  /** Active `AtsEndpoint` rows grouped by `type` (bounded to 32 types). */
  atsEndpointActiveByType: Record<string, number> | null;
  /** Sampled p50 wait of waiting jobs on `ingest-ats-endpoint` (see `ingestAtsQueueWaitSampleSize`). */
  ingestAtsQueueWaitP50Ms: number | null;
  /** Sampled p95 wait (same sample as p50). */
  ingestAtsQueueWaitP95Ms: number | null;
  /** @deprecated Same as `ingestAtsQueueWaitP50Ms` (kept for older dashboards). */
  ingestAtsQueueWaitMedianMs: number | null;
  ingestAtsQueueWaitSampleSize: number | null;
  /** Oldest `updatedAt` among reconcile backlog rows (minutes), bounded query. */
  reconcileOldestStaleMinutes: number | null;
  /** Convenience copy of endpoint drift gates (from `endpoints` row). */
  endpointFreshnessDrift: {
    olderThan1h: number;
    olderThan6h: number;
    olderThan24h: number;
  } | null;
  serpSchedulerHeartbeat: {
    key: string;
    lastBeatIso: string | null;
    ageMs: number | null;
  };
  /** Provider-level freshness distribution. */
  providerFreshness: ProviderFreshnessRow[] | null;
  /** Score tier distribution (Hot/Warm/Cold). */
  scoreTiers: ScoreTierRow | null;
  /** Inactive endpoints that had recent success (recovery candidates). */
  recoverableInactiveCount: number | null;
  /** Orphan active endpoints (no companyId). */
  orphanActiveCount: number | null;
  /** Enrich queue lag + in-process enrichment counters for throughput scaling decisions. */
  enrichThroughput: {
    queueWaiting: number | null;
    oldestWaitingMs: number | null;
    inProcessAttempts: number;
    inProcessFailures: number;
    failureRate: number | null;
    configuredBatchSize: number;
    abortAggressiveScaling: boolean;
    abortReasons: string[];
  } | null;
  workerHeartbeats: WorkerHeartbeatRow[] | null;
  notes: string[];
};

export const SERP_HEARTBEAT_KEY = "scheduler:serp:heartbeat";

/** Parsed Redis heartbeat value (ISO string stored under {@link SERP_HEARTBEAT_KEY}). */
export async function getSerpHeartbeatState(
  redis: Redis,
): Promise<{ lastBeatIso: string; ageMs: number } | null> {
  try {
    const raw = await redis.get(SERP_HEARTBEAT_KEY);
    if (!raw) return null;
    const t = Date.parse(raw);
    if (!Number.isFinite(t)) return null;
    return { lastBeatIso: new Date(t).toISOString(), ageMs: Math.max(0, Date.now() - t) };
  } catch {
    return null;
  }
}

export async function getSerpHeartbeatAgeMs(redis: Redis): Promise<number | null> {
  const s = await getSerpHeartbeatState(redis);
  return s?.ageMs ?? null;
}

/** True when daemon heartbeat is older than ~2× expected interval (ops signal). */
export function isSerpHeartbeatStale(ageMs: number | null, intervalMs: number): boolean {
  if (ageMs == null || intervalMs < 60_000) return false;
  return ageMs > intervalMs * 2 + 120_000;
}

/** Structured heartbeat check for schedulers / validation scripts (read-only semantics). */
export function validateSerpHeartbeatAge(
  ageMs: number | null,
  intervalMs: number,
): { ok: boolean; ageMs: number | null; reason: string | null } {
  if (intervalMs < 60_000) return { ok: true, ageMs, reason: null };
  if (ageMs == null) return { ok: false, ageMs: null, reason: "missing_heartbeat" };
  if (isSerpHeartbeatStale(ageMs, intervalMs)) {
    return { ok: false, ageMs, reason: "heartbeat_stale_vs_interval" };
  }
  return { ok: true, ageMs, reason: null };
}

async function oldestWaitingAgeMs(queue: Queue): Promise<number | null> {
  const jobs = await queue.getJobs(["waiting"], 0, 0, true);
  const j = jobs[0];
  if (!j?.timestamp) return null;
  return Math.max(0, Date.now() - j.timestamp);
}

function linearPercentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0]!;
  const clampedP = Math.min(1, Math.max(0, p));
  const rank = (sorted.length - 1) * clampedP;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! * (hi - rank) + sorted[hi]! * (rank - lo);
}

async function sampledIngestAtsQueueWaitMs(
  name: string,
  connection: ReturnType<typeof getRedisConnection>,
  sample: number,
): Promise<{ p50: number | null; p95: number | null; sampleSize: number }> {
  const q = new Queue(name, { connection });
  try {
    const end = Math.max(0, sample - 1);
    const jobs = await q.getJobs(["waiting"], 0, end, true);
    if (jobs.length === 0) return { p50: null, p95: null, sampleSize: 0 };
    const ages = jobs
      .map((j) => (typeof j.timestamp === "number" ? Math.max(0, Date.now() - j.timestamp) : null))
      .filter((x): x is number => x != null)
      .sort((a, b) => a - b);
    if (ages.length === 0) return { p50: null, p95: null, sampleSize: jobs.length };
    return {
      p50: linearPercentile(ages, 0.5),
      p95: linearPercentile(ages, 0.95),
      sampleSize: ages.length,
    };
  } finally {
    await q.close();
  }
}

async function snapshotQueue(name: string, connection: ReturnType<typeof getRedisConnection>): Promise<QueueDepthRow> {
  const q = new Queue(name, { connection });
  try {
    const c = await q.getJobCounts("waiting", "active", "delayed", "paused", "failed");
    const oldestWaitingMs = await oldestWaitingAgeMs(q);
    return {
      name,
      waiting: c.waiting ?? 0,
      active: c.active ?? 0,
      delayed: c.delayed ?? 0,
      failed: c.failed ?? 0,
      paused: c.paused ?? 0,
      oldestWaitingMs,
    };
  } finally {
    await q.close();
  }
}

export async function buildIngestionObservabilitySnapshot(
  prisma: PrismaClient,
  redis: Redis | null,
): Promise<IngestionObservabilitySnapshot> {
  const notes: string[] = [
    "Queue completed counts omitted (removeOnComplete:true on most queues).",
    "oldestWaitingMs uses first waiting job only (BullMQ ordering); sufficient for alerting.",
    "ingestAtsQueueWaitP50Ms/P95Ms are sampled from up to 20 waiting jobs (not exact distribution).",
  ];
  const generatedAt = new Date().toISOString();
  const connection = getRedisConnection();

  const queueNames = [
    INGEST_ATS_ENDPOINT_QUEUE_NAME,
    JOB_QUEUE_NAME,
    DISCOVER_ATS_ENDPOINTS_QUEUE_NAME,
    DISCOVERY_QUEUE_NAME,
    SERP_QUEUE_NAME,
    ENRICH_COMPANY_QUEUE_NAME,
  ];

  const queues: QueueDepthRow[] = [];
  for (const name of queueNames) {
    try {
      queues.push(await snapshotQueue(name, connection));
    } catch (err) {
      notes.push(`Queue ${name} snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
      queues.push({
        name,
        waiting: -1,
        active: -1,
        delayed: -1,
        failed: -1,
        paused: -1,
        oldestWaitingMs: null,
      });
    }
  }

  let endpoints: EndpointStalenessRow | null = null;
  let primaryJobs: PrimaryLifecycleRow | null = null;
  let throughput1h = {
    jobsCreated: null as number | null,
    endpointCrawls: null as number | null,
    companiesCreated: null as number | null,
  };
  let reconcileStaleParsedProcessing: number | null = null;
  let reconcileOldestStaleMinutes: number | null = null;
  let atsEndpointActiveByType: Record<string, number> | null = null;
  let ingestAtsQueueWaitP50Ms: number | null = null;
  let ingestAtsQueueWaitP95Ms: number | null = null;
  let ingestAtsQueueWaitMedianMs: number | null = null;
  let ingestAtsQueueWaitSampleSize: number | null = null;

  try {
    const epRows = await prisma.$queryRaw<EndpointStalenessRow[]>`
        SELECT
          COUNT(*) FILTER (WHERE "isActive")::int AS active_total,
          COUNT(*) FILTER (WHERE "isActive" AND "lastCrawledAt" IS NULL)::int AS never_crawled,
          COUNT(*) FILTER (WHERE "isActive" AND "lastCrawledAt" >= NOW() - INTERVAL '15 minutes')::int AS fresh_15m,
          COUNT(*) FILTER (
            WHERE "isActive"
              AND ("lastCrawledAt" IS NULL OR "lastCrawledAt" < NOW() - INTERVAL '1 hour')
          )::int AS older_1h,
          COUNT(*) FILTER (
            WHERE "isActive"
              AND ("lastCrawledAt" IS NULL OR "lastCrawledAt" < NOW() - INTERVAL '6 hours')
          )::int AS drift_gt_6h,
          COUNT(*) FILTER (
            WHERE "isActive"
              AND ("lastCrawledAt" IS NULL OR "lastCrawledAt" < NOW() - INTERVAL '24 hours')
          )::int AS drift_gt_24h,
          COUNT(*) FILTER (
            WHERE "isActive"
              AND "lastCrawledAt" IS NOT NULL
              AND "lastCrawledAt" >= NOW() - INTERVAL '15 minutes'
          )::int AS crawled_age_0_15m,
          COUNT(*) FILTER (
            WHERE "isActive"
              AND "lastCrawledAt" IS NOT NULL
              AND "lastCrawledAt" < NOW() - INTERVAL '15 minutes'
              AND "lastCrawledAt" >= NOW() - INTERVAL '1 hour'
          )::int AS crawled_age_15m_1h,
          COUNT(*) FILTER (
            WHERE "isActive"
              AND "lastCrawledAt" IS NOT NULL
              AND "lastCrawledAt" < NOW() - INTERVAL '1 hour'
              AND "lastCrawledAt" >= NOW() - INTERVAL '6 hours'
          )::int AS crawled_age_1h_6h,
          COUNT(*) FILTER (
            WHERE "isActive"
              AND "lastCrawledAt" IS NOT NULL
              AND "lastCrawledAt" < NOW() - INTERVAL '6 hours'
              AND "lastCrawledAt" >= NOW() - INTERVAL '24 hours'
          )::int AS crawled_age_6h_24h,
          COUNT(*) FILTER (
            WHERE "isActive"
              AND "lastCrawledAt" IS NOT NULL
              AND "lastCrawledAt" < NOW() - INTERVAL '24 hours'
          )::int AS crawled_age_gt_24h,
          (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (NOW() - "lastCrawledAt")) / 60)
            FILTER (WHERE "isActive" AND "lastCrawledAt" IS NOT NULL))::float AS p50_age_min,
          (PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (NOW() - "lastCrawledAt")) / 60)
            FILTER (WHERE "isActive" AND "lastCrawledAt" IS NOT NULL))::float AS p95_age_min,
          (MAX(EXTRACT(EPOCH FROM (NOW() - "lastCrawledAt")) / 3600)
            FILTER (WHERE "isActive" AND "lastCrawledAt" IS NOT NULL))::float AS max_age_hours
        FROM "AtsEndpoint"
      `;
    endpoints = epRows[0] ?? null;

    const lifeRows = await prisma.$queryRaw<PrimaryLifecycleSqlRow[]>`
        SELECT
          COUNT(*) FILTER (WHERE "canonicalJobId" IS NULL AND "status" = 'processing' AND "isActive")::bigint AS processing_primaries,
          COUNT(*) FILTER (WHERE "canonicalJobId" IS NULL AND ("status" = 'ready' OR "status" IS NULL) AND "isActive")::bigint AS ready_primaries,
          COUNT(*) FILTER (
            WHERE "canonicalJobId" IS NULL AND "status" = 'processing' AND "isActive"
              AND "parsedDescription" IS NULL
          )::bigint AS processing_no_parse,
          COUNT(*) FILTER (
            WHERE "canonicalJobId" IS NULL AND "status" = 'processing' AND "isActive"
              AND "parsedDescription" IS NOT NULL
          )::bigint AS processing_parse_present,
          (
            MAX(EXTRACT(EPOCH FROM (NOW() - "updatedAt")) / 60)
            FILTER (WHERE "canonicalJobId" IS NULL AND "status" = 'processing' AND "isActive")
          )::float AS oldest_processing_minutes
        FROM "Job"
      `;
    const life = lifeRows[0];
    if (life) {
      primaryJobs = {
        processing_primaries: Number(life.processing_primaries),
        ready_primaries: Number(life.ready_primaries),
        processing_no_parse: Number(life.processing_no_parse),
        processing_parse_present: Number(life.processing_parse_present),
        oldest_processing_minutes: life.oldest_processing_minutes,
      };
    }

    const tJobs = await prisma.$queryRaw<Array<{ c: bigint }>>`
        SELECT COUNT(*)::bigint AS c FROM "Job" WHERE "createdAt" >= NOW() - INTERVAL '1 hour'
      `;
    const tEp = await prisma.$queryRaw<Array<{ c: bigint }>>`
        SELECT COUNT(*)::bigint AS c FROM "AtsEndpoint" WHERE "lastCrawledAt" >= NOW() - INTERVAL '1 hour'
      `;
    const tCo = await prisma.$queryRaw<Array<{ c: bigint }>>`
        SELECT COUNT(*)::bigint AS c FROM "Company" WHERE "createdAt" >= NOW() - INTERVAL '1 hour'
      `;
    throughput1h = {
      jobsCreated: tJobs[0] ? Number(tJobs[0].c) : null,
      endpointCrawls: tEp[0] ? Number(tEp[0].c) : null,
      companiesCreated: tCo[0] ? Number(tCo[0].c) : null,
    };

    const recRows = await prisma.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*)::bigint AS c
      FROM "Job"
      WHERE "canonicalJobId" IS NULL
        AND "status" = 'processing'
        AND "isActive"
        AND "parsedDescription" IS NOT NULL
        AND "updatedAt" < NOW() - INTERVAL '30 minutes'
    `;
    reconcileStaleParsedProcessing = recRows[0] != null ? Number(recRows[0].c) : null;

    const recLagRows = await prisma.$queryRaw<Array<{ m: number | null }>>`
      SELECT (
        MAX(EXTRACT(EPOCH FROM (NOW() - "updatedAt")) / 60)
      )::float AS m
      FROM "Job"
      WHERE "canonicalJobId" IS NULL
        AND "status" = 'processing'
        AND "isActive"
        AND "parsedDescription" IS NOT NULL
        AND "updatedAt" < NOW() - INTERVAL '30 minutes'
    `;
    reconcileOldestStaleMinutes = recLagRows[0]?.m ?? null;

    const typeRows = await prisma.$queryRaw<Array<{ type: string; c: bigint }>>`
      SELECT "type", COUNT(*)::bigint AS c
      FROM "AtsEndpoint"
      WHERE "isActive"
      GROUP BY "type"
      ORDER BY c DESC
      LIMIT 32
    `;
    const byType: Record<string, number> = {};
    for (const row of typeRows) {
      byType[row.type] = Number(row.c);
    }
    atsEndpointActiveByType = Object.keys(byType).length > 0 ? byType : null;

    const wait = await sampledIngestAtsQueueWaitMs(INGEST_ATS_ENDPOINT_QUEUE_NAME, connection, 20);
    ingestAtsQueueWaitP50Ms = wait.p50;
    ingestAtsQueueWaitP95Ms = wait.p95;
    ingestAtsQueueWaitMedianMs = wait.p50;
    ingestAtsQueueWaitSampleSize = wait.sampleSize;
  } catch (err) {
    notes.push(`DB slice failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  let providerFreshness: ProviderFreshnessRow[] | null = null;
  let scoreTiers: ScoreTierRow | null = null;
  let recoverableInactiveCount: number | null = null;
  let orphanActiveCount: number | null = null;

  try {
    const pfRows = await prisma.$queryRaw<ProviderFreshnessRow[]>`
      SELECT type,
        COUNT(*)::int as active,
        COUNT(*) FILTER (WHERE "lastCrawledAt" > NOW() - INTERVAL '1 hour')::int as fresh_1h,
        COUNT(*) FILTER (WHERE "lastCrawledAt" > NOW() - INTERVAL '6 hours')::int as fresh_6h,
        COUNT(*) FILTER (WHERE "lastCrawledAt" < NOW() - INTERVAL '24 hours' OR "lastCrawledAt" IS NULL)::int as stale_24h_plus
      FROM "AtsEndpoint" WHERE "isActive" = true
      GROUP BY type ORDER BY active DESC LIMIT 20
    `;
    providerFreshness = pfRows;

    const stRows = await prisma.$queryRaw<Array<{ hot: bigint; warm: bigint; cold: bigint }>>`
      SELECT
        COUNT(*) FILTER (WHERE score >= 80)::bigint as hot,
        COUNT(*) FILTER (WHERE score >= 40 AND score < 80)::bigint as warm,
        COUNT(*) FILTER (WHERE score < 40)::bigint as cold
      FROM "AtsEndpoint" WHERE "isActive" = true
    `;
    if (stRows[0]) {
      scoreTiers = { hot: Number(stRows[0].hot), warm: Number(stRows[0].warm), cold: Number(stRows[0].cold) };
    }

    const recRows2 = await prisma.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*)::bigint as c FROM "AtsEndpoint"
      WHERE "isActive" = false AND "lastSuccessAt" > NOW() - INTERVAL '30 days'
    `;
    recoverableInactiveCount = recRows2[0] ? Number(recRows2[0].c) : null;

    const orphRows = await prisma.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*)::bigint as c FROM "AtsEndpoint"
      WHERE "companyId" IS NULL AND "isActive" = true
    `;
    orphanActiveCount = orphRows[0] ? Number(orphRows[0].c) : null;
  } catch (err) {
    notes.push(`Extended metrics failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const endpointFreshnessDrift =
    endpoints != null
      ? {
          olderThan1h: endpoints.older_1h,
          olderThan6h: endpoints.drift_gt_6h,
          olderThan24h: endpoints.drift_gt_24h,
        }
      : null;

  let serpSchedulerHeartbeat: IngestionObservabilitySnapshot["serpSchedulerHeartbeat"] = {
    key: SERP_HEARTBEAT_KEY,
    lastBeatIso: null,
    ageMs: null,
  };
  if (redis) {
    try {
      const hb = await getSerpHeartbeatState(redis);
      if (hb) {
        serpSchedulerHeartbeat = {
          key: SERP_HEARTBEAT_KEY,
          lastBeatIso: hb.lastBeatIso,
          ageMs: hb.ageMs,
        };
      }
    } catch {
      notes.push("Redis read for SERP heartbeat failed.");
    }
  } else {
    notes.push("Redis client not provided; SERP heartbeat omitted.");
  }

  let enrichThroughput: IngestionObservabilitySnapshot["enrichThroughput"] = null;
  let workerHeartbeats: WorkerHeartbeatRow[] | null = null;
  if (redis) {
    try {
      workerHeartbeats = await readWorkerHeartbeats(redis);
    } catch {
      notes.push("Worker heartbeat read failed.");
    }
  }

  const enrichQueue = queues.find((q) => q.name === ENRICH_COMPANY_QUEUE_NAME);
  const discoveryMetrics = getCompanyDiscoveryMetrics();
  const enrichFailureDenom = discoveryMetrics.enrichmentSuccesses + discoveryMetrics.enrichmentFailures;
  const enrichFailureRate =
    enrichFailureDenom > 0 ? discoveryMetrics.enrichmentFailures / enrichFailureDenom : null;
  const configuredBatchSize = Math.max(
    1,
    Math.min(
      500,
      Number(process.env.DISCOVERY_ENRICH_BATCH_SIZE ?? "30") || 30,
    ),
  );
  const abortReasons: string[] = [];
  if (enrichQueue && enrichQueue.oldestWaitingMs != null && enrichQueue.oldestWaitingMs > 30 * 60_000) {
    abortReasons.push("enrich_queue_lag_gt_30m");
  }
  if (enrichFailureRate != null && enrichFailureRate > 0.25) {
    abortReasons.push("enrich_failure_rate_gt_25pct");
  }
  if (ingestAtsQueueWaitP95Ms != null && ingestAtsQueueWaitP95Ms > 20 * 60_000) {
    abortReasons.push("ingest_ats_queue_wait_p95_gt_20m");
  }
  enrichThroughput = {
    queueWaiting: enrichQueue?.waiting ?? null,
    oldestWaitingMs: enrichQueue?.oldestWaitingMs ?? null,
    inProcessAttempts: discoveryMetrics.enrichmentAttempts,
    inProcessFailures: discoveryMetrics.enrichmentFailures,
    failureRate: enrichFailureRate,
    configuredBatchSize,
    abortAggressiveScaling: abortReasons.length > 0,
    abortReasons,
  };

  return {
    generatedAt,
    queues,
    endpoints,
    primaryJobs,
    throughput1h,
    reconcileStaleParsedProcessing,
    reconcileOldestStaleMinutes,
    atsEndpointActiveByType,
    ingestAtsQueueWaitP50Ms,
    ingestAtsQueueWaitP95Ms,
    ingestAtsQueueWaitMedianMs,
    ingestAtsQueueWaitSampleSize,
    endpointFreshnessDrift,
    serpSchedulerHeartbeat,
    providerFreshness,
    scoreTiers,
    recoverableInactiveCount,
    orphanActiveCount,
    enrichThroughput,
    workerHeartbeats,
    notes,
  };
}

/** Call from SERP scheduler after successful enqueue (one-shot or daemon). */
export async function touchSerpSchedulerHeartbeat(redis: Redis): Promise<void> {
  const iso = new Date().toISOString();
  await redis.set(SERP_HEARTBEAT_KEY, iso, "EX", 7 * 24 * 3600);
}
