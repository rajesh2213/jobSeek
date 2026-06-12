/**
 * Crawl-frequency audit: active endpoint coverage, cooldown eligibility, queue dedup simulation.
 * Run: npx tsx scripts/ingestion/crawlFrequencyAudit.ts
 */
import { Queue } from "bullmq";
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";
import { getRedisConnection } from "../../src/queues/job.queue.js";
import { INGEST_ATS_ENDPOINT_QUEUE_NAME } from "../../src/queues/ats-endpoint.queue.js";

function endpointCooldownMs(score: number): number {
  const hotMin = 15;
  const warmMin = 120;
  const coldMin = 480;
  if (score >= 80) return Math.max(5 * 60_000, hotMin * 60_000);
  if (score >= 40) return Math.max(30 * 60_000, warmMin * 60_000);
  return Math.max(60 * 60_000, coldMin * 60_000);
}

function tierLabel(score: number): "hot" | "warm" | "cold" {
  if (score >= 80) return "hot";
  if (score >= 40) return "warm";
  return "cold";
}

/** Scheduler runs every 5–8 min; batch up to 40 (default). */
const SCHED_MIN_INTERVAL_MS = 5 * 60_000;
const SCHED_MAX_INTERVAL_MS = 8 * 60_000;
const SCHED_AVG_INTERVAL_MS = (SCHED_MIN_INTERVAL_MS + SCHED_MAX_INTERVAL_MS) / 2;
const DEFAULT_BATCH_SIZE = 40;

async function main(): Promise<void> {
  loadRootEnv();
  const now = Date.now();

  const byType = await prisma.$queryRaw<
    Array<{ type: string; active_count: number }>
  >`
    SELECT type, COUNT(*)::int AS active_count
    FROM "AtsEndpoint"
    WHERE "isActive" = true
    GROUP BY type
    ORDER BY active_count DESC
  `;

  const crawlWindows = await prisma.$queryRaw<
    Array<{
      type: string;
      active_total: number;
      crawled_24h: number;
      crawled_7d: number;
      crawled_30d: number;
      never_crawled: number;
    }>
  >`
    SELECT
      type,
      COUNT(*)::int AS active_total,
      COUNT(*) FILTER (WHERE "lastCrawledAt" >= NOW() - INTERVAL '24 hours')::int AS crawled_24h,
      COUNT(*) FILTER (WHERE "lastCrawledAt" >= NOW() - INTERVAL '7 days')::int AS crawled_7d,
      COUNT(*) FILTER (WHERE "lastCrawledAt" >= NOW() - INTERVAL '30 days')::int AS crawled_30d,
      COUNT(*) FILTER (WHERE "lastCrawledAt" IS NULL)::int AS never_crawled
    FROM "AtsEndpoint"
    WHERE "isActive" = true
    GROUP BY type
    ORDER BY active_total DESC
  `;

  const totals = await prisma.$queryRaw<
    Array<{
      active_total: number;
      crawled_24h: number;
      crawled_7d: number;
      crawled_30d: number;
      never_crawled: number;
    }>
  >`
    SELECT
      COUNT(*)::int AS active_total,
      COUNT(*) FILTER (WHERE "lastCrawledAt" >= NOW() - INTERVAL '24 hours')::int AS crawled_24h,
      COUNT(*) FILTER (WHERE "lastCrawledAt" >= NOW() - INTERVAL '7 days')::int AS crawled_7d,
      COUNT(*) FILTER (WHERE "lastCrawledAt" >= NOW() - INTERVAL '30 days')::int AS crawled_30d,
      COUNT(*) FILTER (WHERE "lastCrawledAt" IS NULL)::int AS never_crawled
    FROM "AtsEndpoint"
    WHERE "isActive" = true
  `;

  const avgAge = await prisma.$queryRaw<
    Array<{
      type: string;
      with_crawl: number;
      avg_hours_since_crawl: number | null;
      p50_hours_since_crawl: number | null;
      p95_hours_since_crawl: number | null;
    }>
  >`
    SELECT
      type,
      COUNT(*)::int AS with_crawl,
      AVG(EXTRACT(EPOCH FROM (NOW() - "lastCrawledAt")) / 3600.0)::float AS avg_hours_since_crawl,
      PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (NOW() - "lastCrawledAt")) / 3600.0
      )::float AS p50_hours_since_crawl,
      PERCENTILE_CONT(0.95) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (NOW() - "lastCrawledAt")) / 3600.0
      )::float AS p95_hours_since_crawl
    FROM "AtsEndpoint"
    WHERE "isActive" = true AND "lastCrawledAt" IS NOT NULL
    GROUP BY type
    ORDER BY with_crawl DESC
  `;

  const intervalEst = await prisma.$queryRaw<
    Array<{
      type: string;
      n: number;
      avg_hours_between_crawls_lifetime: number | null;
    }>
  >`
    SELECT
      type,
      COUNT(*)::int AS n,
      AVG(
        CASE
          WHEN "successCount" > 1
            AND "lastCrawledAt" IS NOT NULL
            AND "createdAt" < "lastCrawledAt"
          THEN EXTRACT(EPOCH FROM ("lastCrawledAt" - "createdAt")) / ("successCount" - 1) / 3600.0
          ELSE NULL
        END
      )::float AS avg_hours_between_crawls_lifetime
    FROM "AtsEndpoint"
    WHERE "isActive" = true AND "successCount" > 1
    GROUP BY type
    ORDER BY n DESC
  `;

  const scoreBuckets = await prisma.$queryRaw<
    Array<{
      score_gte_80: number;
      score_gte_60: number;
      score_gte_40: number;
      active_total: number;
    }>
  >`
    SELECT
      COUNT(*) FILTER (WHERE score >= 80)::int AS score_gte_80,
      COUNT(*) FILTER (WHERE score >= 60)::int AS score_gte_60,
      COUNT(*) FILTER (WHERE score >= 40)::int AS score_gte_40,
      COUNT(*)::int AS active_total
    FROM "AtsEndpoint"
    WHERE "isActive" = true
  `;

  const scoreByType = await prisma.$queryRaw<
    Array<{
      type: string;
      gte_80: number;
      gte_60: number;
      gte_40: number;
      total: number;
    }>
  >`
    SELECT
      type,
      COUNT(*) FILTER (WHERE score >= 80)::int AS gte_80,
      COUNT(*) FILTER (WHERE score >= 60)::int AS gte_60,
      COUNT(*) FILTER (WHERE score >= 40)::int AS gte_40,
      COUNT(*)::int AS total
    FROM "AtsEndpoint"
    WHERE "isActive" = true
    GROUP BY type
    ORDER BY total DESC
  `;

  const endpoints = await prisma.atsEndpoint.findMany({
    where: { isActive: true },
    select: { id: true, type: true, score: true, lastCrawledAt: true },
  });

  let eligibleNow = 0;
  let eligibleNotCrawled24h = 0;
  const eligibleByType: Record<string, { eligible: number; eligible_stale_24h: number }> = {};
  const eligibleByTier: Record<string, number> = { hot: 0, warm: 0, cold: 0 };
  const stale24hByTier: Record<string, number> = { hot: 0, warm: 0, cold: 0 };

  for (const ep of endpoints) {
    const cooldown = endpointCooldownMs(ep.score);
    const lastMs = ep.lastCrawledAt?.getTime() ?? 0;
    const isEligible = ep.lastCrawledAt == null || now - lastMs >= cooldown;
    const tier = tierLabel(ep.score);
    if (!eligibleByType[ep.type]) {
      eligibleByType[ep.type] = { eligible: 0, eligible_stale_24h: 0 };
    }
    if (isEligible) {
      eligibleNow++;
      eligibleByType[ep.type].eligible++;
      eligibleByTier[tier]++;
      const crawled24h =
        ep.lastCrawledAt != null && now - ep.lastCrawledAt.getTime() < 24 * 3_600_000;
      if (!crawled24h) {
        eligibleNotCrawled24h++;
        eligibleByType[ep.type].eligible_stale_24h++;
        stale24hByTier[tier]++;
      }
    }
  }

  const dailyCrawls = await prisma.$queryRaw<
    Array<{ day: Date; endpoints_crawled: number }>
  >`
    SELECT
      DATE_TRUNC('day', "lastCrawledAt")::date AS day,
      COUNT(*)::int AS endpoints_crawled
    FROM "AtsEndpoint"
    WHERE "lastCrawledAt" >= NOW() - INTERVAL '7 days'
    GROUP BY 1
    ORDER BY 1 DESC
  `;

  // Observed crawl rate: endpoints whose lastCrawledAt moved in last 24h (proxy for completed ingests)
  const observedCrawls24h = Number(totals[0]?.crawled_24h ?? 0);

  let queueStats: Record<string, unknown> = {};
  try {
    const queue = new Queue(INGEST_ATS_ENDPOINT_QUEUE_NAME, { connection: getRedisConnection() });
    const [waiting, active, delayed, failed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getDelayedCount(),
      queue.getFailedCount(),
    ]);
    // Paginate waiting jobs — full scan of 29k+ jobs is slow but required for exact dedup sim.
    const endpointIds = new Map<string, number>();
    const pageSize = 500;
    let start = 0;
    while (start < waiting) {
      const end = Math.min(start + pageSize - 1, waiting - 1);
      const page = await queue.getJobs(["waiting"], start, end, true);
      if (page.length === 0) break;
      for (const j of page) {
        const eid = (j.data as { endpointId?: string })?.endpointId;
        if (eid) endpointIds.set(eid, (endpointIds.get(eid) ?? 0) + 1);
      }
      start += pageSize;
    }
    const uniqueInWaiting = endpointIds.size;
    const dupRatio = uniqueInWaiting > 0 ? waiting / uniqueInWaiting : 0;
    queueStats = {
      waiting,
      active,
      delayed,
      failed,
      uniqueEndpointsInWaiting: uniqueInWaiting,
      duplicateRatio: Number(dupRatio.toFixed(2)),
      postDedupQueueSize: uniqueInWaiting + active + delayed,
      duplicatesRemovable: waiting - uniqueInWaiting,
    };
    await queue.close();
  } catch (err) {
    queueStats = { error: String(err) };
  }

  const activeTotal = Number(totals[0]?.active_total ?? 0);
  const schedRunsPerDay = (24 * 60 * 60_000) / SCHED_AVG_INTERVAL_MS;
  const schedEnqueuesPerDayNoDedup = schedRunsPerDay * DEFAULT_BATCH_SIZE;

  // Empirical avg job duration from 7d daily crawls / worker throughput
  const dailyCounts = dailyCrawls.map((d) => d.endpoints_crawled);
  const avgDailyCrawls =
    dailyCounts.length > 0
      ? dailyCounts.reduce((a, b) => a + b, 0) / dailyCounts.length
      : observedCrawls24h;

  // Conservative job duration estimates (minutes) from provider mix
  const typeMix = Object.fromEntries(byType.map((r) => [r.type, r.active_count / activeTotal]));
  const durationMinutesByType: Record<string, number> = {
    workday: 8,
    greenhouse: 2,
    lever: 2,
    ashby: 2,
    bamboohr: 3,
    teamtailor: 2,
    rippling: 2,
    jobvite: 2,
    smartrecruiters: 2,
    workable: 2,
  };
  let weightedAvgJobMin = 3;
  for (const [type, share] of Object.entries(typeMix)) {
    weightedAvgJobMin += share * ((durationMinutesByType[type] ?? 2.5) - 3);
  }

  function simulateThroughput(concurrency: number) {
    const jobsPerHour = (60 / weightedAvgJobMin) * concurrency;
    const crawlsPerDay = jobsPerHour * 24;
    const fullCycleDays = activeTotal / crawlsPerDay;
    const avgRecrawlIntervalHours = (fullCycleDays * 24) / Math.max(1, activeTotal) * activeTotal;
    // Simpler: time to crawl all active once
    const daysToCoverAllActive = activeTotal / crawlsPerDay;
    const expectedRecrawlIntervalHours = daysToCoverAllActive * 24;

    // Scheduler-limited: max unique enqueues when deduped
    const eligiblePerTick = Math.min(DEFAULT_BATCH_SIZE, eligibleNow);
    const uniqueEnqueuesPerDay = schedRunsPerDay * eligiblePerTick;
    const schedulerLimitedCrawlsPerDay = Math.min(crawlsPerDay, uniqueEnqueuesPerDay);

    return {
      concurrency,
      assumedAvgJobMinutes: Number(weightedAvgJobMin.toFixed(2)),
      workerCapacityCrawlsPerDay: Math.round(crawlsPerDay),
      schedulerMaxUniqueEnqueuesPerDay: Math.round(uniqueEnqueuesPerDay),
      effectiveCrawlsPerDay: Math.round(schedulerLimitedCrawlsPerDay),
      activeEndpointsCoveredPerDay: Math.round(
        Math.min(activeTotal, schedulerLimitedCrawlsPerDay),
      ),
      expectedFullCycleRecrawlHours: Number(
        ((activeTotal / schedulerLimitedCrawlsPerDay) * 24).toFixed(1),
      ),
      pctActiveCrawledPerDay: Number(
        ((schedulerLimitedCrawlsPerDay / activeTotal) * 100).toFixed(1),
      ),
    };
  }

  const report = {
    generatedAt: new Date().toISOString(),
    activeEndpointsByAts: byType,
    crawlCoverage: {
      totals: totals[0],
      byAts: crawlWindows,
      pctCrawled24h: Number(
        (((totals[0]?.crawled_24h ?? 0) / activeTotal) * 100).toFixed(1),
      ),
      pctCrawled7d: Number(
        (((totals[0]?.crawled_7d ?? 0) / activeTotal) * 100).toFixed(1),
      ),
      pctCrawled30d: Number(
        (((totals[0]?.crawled_30d ?? 0) / activeTotal) * 100).toFixed(1),
      ),
    },
    recrawlInterval: {
      hoursSinceLastCrawlByAts: avgAge,
      lifetimeAvgHoursBetweenCrawlsByAts: intervalEst,
      note:
        "hoursSinceLastCrawl = current staleness; lifetimeAvg = (lastCrawled-created)/(successCount-1) proxy",
    },
    cooldownEligibleNotCrawled24h: {
      eligibleNow,
      eligibleNotCrawledIn24h: eligibleNotCrawled24h,
      pctEligibleStale: Number(((eligibleNotCrawled24h / Math.max(1, eligibleNow)) * 100).toFixed(1)),
      byAts: eligibleByType,
      byTier: { eligible: eligibleByTier, stale24h: stale24hByTier },
      interpretation:
        "Endpoints past cooldown but not crawled in 24h indicate worker/queue bottleneck, not scheduler selection",
    },
    scoreDistribution: {
      global: scoreBuckets[0],
      byAts: scoreByType,
    },
    queueDedupSimulation: queueStats,
    observedThroughput: {
      crawlsLast24h: observedCrawls24h,
      dailyCrawlsLast7d: dailyCrawls,
      avgDailyCrawls7d: Number(avgDailyCrawls.toFixed(0)),
      schedulerEnqueuesPerDayWithoutDedup: Math.round(schedEnqueuesPerDayNoDedup),
    },
    postDedupSimulation: {
      concurrency1: simulateThroughput(1),
      concurrency2: simulateThroughput(2),
      eligibleNow,
      schedRunsPerDay: Number(schedRunsPerDay.toFixed(1)),
      batchSize: DEFAULT_BATCH_SIZE,
    },
    bottlenecks: [] as string[],
  };

  if (Number(queueStats.duplicateRatio) > 2) {
    report.bottlenecks.push(
      `Queue duplicate ratio ${queueStats.duplicateRatio}x — worker time spent re-crawling queued duplicates`,
    );
  }
  if (eligibleNotCrawled24h > eligibleNow * 0.3) {
    report.bottlenecks.push(
      `${eligibleNotCrawled24h} endpoints (${report.cooldownEligibleNotCrawled24h.pctEligibleStale}%) are cooldown-eligible but stale >24h — coverage artificially limited`,
    );
  }
  if (observedCrawls24h < activeTotal * 0.5) {
    report.bottlenecks.push(
      `Only ${report.crawlCoverage.pctCrawled24h}% of active endpoints crawled in 24h (target for healthy coverage: >80% for warm/hot mix)`,
    );
  }
  if (report.postDedupSimulation.concurrency1.effectiveCrawlsPerDay < eligibleNow) {
    report.bottlenecks.push(
      `Worker capacity (${report.postDedupSimulation.concurrency1.effectiveCrawlsPerDay}/day) < cooldown-eligible pool (${eligibleNow}) — backlog will grow even after dedup`,
    );
  }

  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();
}

void main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
