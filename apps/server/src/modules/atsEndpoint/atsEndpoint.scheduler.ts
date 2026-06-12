import { loadRootEnv } from "../../infrastructure/env/loadEnv.js";
import { prisma } from "../../infrastructure/db/prisma.js";
import { logger } from "../../utils/logger.js";
import { assertWorkerProcessEnv } from "../../infrastructure/env/validateWorkerEnv.js";
import { registerSchedulerShutdown } from "../../utils/schedulerShutdown.js";
import {
  getIngestAtsEndpointQueue,
  closeIngestAtsEndpointQueue,
  INGEST_ATS_ENDPOINT_QUEUE_NAME,
} from "../../queues/ats-endpoint.queue.js";
import { enqueueAtsEndpointIngest } from "../../queues/atsEndpointEnqueue.js";
import { getEndpointPriority } from "./atsEndpointPriority.js";
import {
  applyOpenClawActiveScoreFloor,
  isOpenClawPastActiveCrawlCooldown,
  OPENCLAW_SOURCE,
} from "./openClawActiveScore.js";
import { assertRequiredSelect, logQueryMetrics } from "../../utils/queryMetrics.js";

/**
 * TODO(provider-isolation): Today all crawlable endpoints share one Bull queue (`ingest-ats-endpoint`)
 * and one worker concurrency budget. A long Workday ingest can starve other providers.
 * Set `ATS_ENDPOINT_SCHEDULER_MAX_PER_TYPE` (1–50, default **0** = off) to cap each `type` in the
 * first pass of a batch, then fill remaining slots by global priority — reduces Workday monopolization.
 */
const MIN_INTERVAL_MS = 5 * 60 * 1000;
const MAX_INTERVAL_MS = 8 * 60 * 1000;

const DEFAULT_POOL_LIMIT = 100;
const DEFAULT_BATCH_SIZE = 40;
const MIN_BATCH_SIZE = 20;
const MAX_BATCH_SIZE = 100;

function poolLimitFromEnv(): number {
  const raw =
    process.env.ATS_ENDPOINT_POOL_SIZE ?? process.env.ATS_ENDPOINT_POOL_LIMIT ?? String(DEFAULT_POOL_LIMIT);
  return Math.max(10, Math.min(100, Number(raw) || DEFAULT_POOL_LIMIT));
}

function batchSizeFromEnv(): number {
  const raw = process.env.ATS_ENDPOINT_BATCH_SIZE ?? String(DEFAULT_BATCH_SIZE);
  return Math.max(MIN_BATCH_SIZE, Math.min(MAX_BATCH_SIZE, Number(raw) || DEFAULT_BATCH_SIZE));
}

function cooldownMinutesFromEnv(envKey: string, defaultMinutes: number): number {
  const raw = process.env[envKey];
  if (raw == null || raw.trim() === "") return defaultMinutes;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return defaultMinutes;
  return n;
}
// REQUIRED_SELECT
const ATS_ENDPOINT_SCHED_SELECT = {
  id: true,
  type: true,
  score: true,
  successCount: true,
  lastCrawledAt: true,
  source: true,
  isActive: true,
} as const;

/**
 * Tiered crawl cooldowns based on dynamic endpoint score.
 *   Hot (80+):  15 minutes
 *   Warm (40-79): 2 hours
 *   Cold (<40):  8 hours
 * Env overrides (minutes): ATS_ENDPOINT_HIGH|MEDIUM|LOW_PRIORITY_COOLDOWN_MINUTES
 * Legacy ms overrides: ATS_COOLDOWN_HOT_MS, ATS_COOLDOWN_WARM_MS, ATS_COOLDOWN_COLD_MS
 */
function endpointCooldownMs(score: number): number {
  const hotMin = cooldownMinutesFromEnv("ATS_ENDPOINT_HIGH_PRIORITY_COOLDOWN_MINUTES", 15);
  const warmMin = cooldownMinutesFromEnv("ATS_ENDPOINT_MEDIUM_PRIORITY_COOLDOWN_MINUTES", 120);
  const coldMin = cooldownMinutesFromEnv("ATS_ENDPOINT_LOW_PRIORITY_COOLDOWN_MINUTES", 480);
  if (score >= 80) {
    const ms = envMsOrMinutes(process.env.ATS_COOLDOWN_HOT_MS, hotMin * 60_000);
    return Math.max(5 * 60_000, ms);
  }
  if (score >= 40) {
    const ms = envMsOrMinutes(process.env.ATS_COOLDOWN_WARM_MS, warmMin * 60_000);
    return Math.max(30 * 60_000, ms);
  }
  const ms = envMsOrMinutes(process.env.ATS_COOLDOWN_COLD_MS, coldMin * 60_000);
  return Math.max(60 * 60_000, ms);
}

function envMsOrMinutes(rawMs: string | undefined, fallbackMs: number): number {
  if (rawMs != null && rawMs.trim() !== "") {
    const ms = Number(rawMs);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  return fallbackMs;
}

function randomIntInclusive(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

type SchedEp = {
  id: string;
  type: string;
  score: number;
  successCount: number;
  lastCrawledAt: Date | null;
  source?: string | null;
  isActive?: boolean;
};

/** Always schedule eligible active OpenClaw boards (reserved slots before global pool). */
async function fetchEligibleOpenClawActiveEndpoints(nowMs: number): Promise<SchedEp[]> {
  const rows = await prisma.atsEndpoint.findMany({
    where: { source: OPENCLAW_SOURCE, isActive: true },
    select: ATS_ENDPOINT_SCHED_SELECT,
  });
  const eligible = rows
    .map((row) => {
      const score = applyOpenClawActiveScoreFloor(row.score, row.source, row.isActive);
      return { ...row, score };
    })
    .filter((row) => isOpenClawPastActiveCrawlCooldown(row.lastCrawledAt, nowMs));

  eligible.sort((a, b) => {
    const d = getEndpointPriority(b) - getEndpointPriority(a);
    if (d !== 0) return d;
    return a.id.localeCompare(b.id);
  });
  return eligible;
}

function mergeOpenClawReservedIntoBatch(
  reserved: SchedEp[],
  batch: SchedEp[],
  maxTotal: number,
): SchedEp[] {
  const seen = new Set<string>();
  const out: SchedEp[] = [];
  for (const row of reserved) {
    if (out.length >= maxTotal) break;
    seen.add(row.id);
    out.push(row);
  }
  for (const row of batch) {
    if (out.length >= maxTotal) break;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

/**
 * Starvation guard: first pass respects global priority order but caps each `type`
 * at `maxPerType`. Second pass fills up to `maxTotal` with remaining rows (preserves
 * global priority order) **without** per-type caps so low-volume providers cannot be
 * permanently starved when the pool is larger than `maxTotal`. Set
 * `ATS_ENDPOINT_SCHEDULER_MAX_PER_TYPE=0` to disable fairness slicing.
 */
function fairBatchSlice(
  sorted: SchedEp[],
  maxTotal: number,
  maxPerType: number,
): { batch: SchedEp[]; skippedFirstPassByType: Record<string, number> } {
  if (maxPerType <= 0 || sorted.length === 0) {
    return { batch: sorted.slice(0, maxTotal), skippedFirstPassByType: {} };
  }
  const perType = new Map<string, number>();
  const skippedFirstPassByType: Record<string, number> = {};
  const out: SchedEp[] = [];
  for (const row of sorted) {
    if (out.length >= maxTotal) break;
    const c = perType.get(row.type) ?? 0;
    if (c >= maxPerType) {
      skippedFirstPassByType[row.type] = (skippedFirstPassByType[row.type] ?? 0) + 1;
      continue;
    }
    perType.set(row.type, c + 1);
    out.push(row);
  }
  if (out.length < maxTotal) {
    for (const row of sorted) {
      if (out.length >= maxTotal) break;
      if (out.some((o) => o.id === row.id)) continue;
      out.push(row);
    }
  }
  return { batch: out, skippedFirstPassByType };
}

async function enqueuePrioritizedIngests(): Promise<void> {
  const queue = getIngestAtsEndpointQueue();
  const now = new Date();
  const nowMs = now.getTime();
  const poolLimit = poolLimitFromEnv();
  const baseBatchSize = batchSizeFromEnv();
  assertRequiredSelect("AtsEndpoint", "atsEndpoint.scheduler.findMany", ATS_ENDPOINT_SCHED_SELECT);

  const pool = await prisma.atsEndpoint.findMany({
    where: {
      isActive: true,
      OR: [
        { score: { gte: 80 }, OR: [{ lastCrawledAt: null }, { lastCrawledAt: { lt: new Date(nowMs - endpointCooldownMs(80)) } }] },
        { score: { gte: 40, lt: 80 }, OR: [{ lastCrawledAt: null }, { lastCrawledAt: { lt: new Date(nowMs - endpointCooldownMs(40)) } }] },
        { score: { lt: 40 }, OR: [{ lastCrawledAt: null }, { lastCrawledAt: { lt: new Date(nowMs - endpointCooldownMs(0)) } }] },
      ],
    },
    select: ATS_ENDPOINT_SCHED_SELECT,
    orderBy: [{ score: "desc" }, { successCount: "desc" }, { lastCrawledAt: "asc" }],
    take: poolLimit,
  });
  const queryMetrics = logQueryMetrics("atsEndpoint.scheduler.findMany", pool, 256, {
    countTowardEgress: false,
  });

  pool.sort((a, b) => {
    const d = getEndpointPriority(b) - getEndpointPriority(a);
    if (d !== 0) return d;
    return a.id.localeCompare(b.id);
  });
  let adaptiveBatchSize = baseBatchSize;
  if (queryMetrics.estimatedKB > 500) adaptiveBatchSize = Math.max(MIN_BATCH_SIZE, Math.floor(baseBatchSize / 2));
  else if (queryMetrics.estimatedKB < 100) adaptiveBatchSize = Math.min(MAX_BATCH_SIZE, baseBatchSize + 20);
  const maxPerTypeRaw = Number(process.env.ATS_ENDPOINT_SCHEDULER_MAX_PER_TYPE ?? "0");
  const maxPerType = Number.isFinite(maxPerTypeRaw)
    ? Math.max(0, Math.min(50, Math.floor(maxPerTypeRaw)))
    : 12;
  const openclawReserved = await fetchEligibleOpenClawActiveEndpoints(nowMs);
  const fair = fairBatchSlice(pool as SchedEp[], adaptiveBatchSize, maxPerType);
  const top = mergeOpenClawReservedIntoBatch(openclawReserved, fair.batch, adaptiveBatchSize);

  if (maxPerType > 0 && top.length > 0) {
    const byType: Record<string, number> = {};
    for (const row of top) {
      byType[row.type] = (byType[row.type] ?? 0) + 1;
    }
    const skippedTypes = Object.entries(fair.skippedFirstPassByType).filter(([, n]) => n > 0);
    logger.info(
      {
        event: "ats_endpoint_scheduler_fairness",
        maxPerType,
        enqueued: top.length,
        poolSize: pool.length,
        enqueueByType: byType,
        skippedFirstPassTotal: skippedTypes.reduce((a, [, n]) => a + n, 0),
        skippedFirstPassByType: Object.fromEntries(skippedTypes),
      },
      "ats_endpoint_scheduler_fairness",
    );
  }

  for (const ep of top) {
    await enqueueAtsEndpointIngest(queue, ep.id);
  }

  const tierCounts = { hot: 0, warm: 0, cold: 0 };
  for (const ep of top) {
    if (ep.score >= 80) tierCounts.hot++;
    else if (ep.score >= 40) tierCounts.warm++;
    else tierCounts.cold++;
  }

  logger.info(
    {
      event: "ats_endpoint_scheduler_run",
      queue: INGEST_ATS_ENDPOINT_QUEUE_NAME,
      poolSize: pool.length,
      eligibleCount: pool.length,
      openclaw_reserved: openclawReserved.length,
      openclaw_reserved_ids: openclawReserved.map((r) => r.id),
      enqueued: top.length,
      batchSize: adaptiveBatchSize,
      baseBatchSize,
      poolLimit,
      maxPerTypeFairness: maxPerType,
      estimatedKB: Number(queryMetrics.estimatedKB.toFixed(2)),
      tierCounts,
      cooldowns: {
        hot_ms: endpointCooldownMs(80),
        warm_ms: endpointCooldownMs(40),
        cold_ms: endpointCooldownMs(0),
      },
    },
    "ats_endpoint_scheduler_run",
  );
}

async function main(): Promise<void> {
  loadRootEnv();
  assertWorkerProcessEnv();
  void INGEST_ATS_ENDPOINT_QUEUE_NAME;

  logger.info({ event: "ats_endpoint_scheduler_started" }, "ats_endpoint_scheduler_started");

  try {
    await enqueuePrioritizedIngests();
  } catch (err) {
    logger.error({ event: "ats_endpoint_scheduler_run_failed", err }, "ats_endpoint_scheduler_run_failed");
  }

  const ms = randomIntInclusive(MIN_INTERVAL_MS, MAX_INTERVAL_MS);
  const interval = setInterval(() => {
    void enqueuePrioritizedIngests().catch((err) => {
      logger.error({ event: "ats_endpoint_scheduler_run_failed", err }, "ats_endpoint_scheduler_run_failed");
    });
  }, ms);

  registerSchedulerShutdown({
    intervalIds: [interval],
    closeQueues: [closeIngestAtsEndpointQueue],
    prismaDisconnect: () => prisma.$disconnect(),
  });
}

void main().catch((err) => {
  logger.error({ event: "ats_endpoint_scheduler_boot_failed", err }, "ats_endpoint_scheduler_boot_failed");
  process.exitCode = 1;
});
