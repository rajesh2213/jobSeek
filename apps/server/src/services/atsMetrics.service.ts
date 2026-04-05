/**
 * Phase 5 — ATS pipeline observability aggregates (Prisma + optional Redis + in-process counters).
 * Segment by normalized AtsEndpoint source: serp | job | enrichment.
 */

import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import {
  getDiscoveryProcessBySource,
  getIngestionDuplicateSkipTotals,
  getIngestionProcessBySource,
  getIngestionWasteTotals,
  getSerpProcessCounters,
  getValidationWasteCounters,
} from "./atsPipelineCounters.service.js";
import {
  type MetricsSourceBucket,
  normalizeEndpointMetricsSource,
} from "./atsMetrics.types.js";

export type { MetricsSourceBucket } from "./atsMetrics.types.js";
export { normalizeEndpointMetricsSource } from "./atsMetrics.types.js";

const SERP_SKIP_KEY_PREFIX = "serp:skip_query:";

/** Exclusive activation classification (no schema field). */
export function classifyEndpointActivation(ep: {
  score: number;
  successCount: number;
}): "score" | "validation" | "default" | "other" {
  if (ep.score >= 8) return "score";
  if (ep.successCount > 0) return "validation";
  if (ep.score === 0) return "default";
  return "other";
}

function safeDiv(n: number, d: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return 0;
  return n / d;
}

export async function countRedisKeysByPrefix(redis: Redis, prefix: string): Promise<number> {
  const pattern = `${prefix}*`;
  let cursor = "0";
  let total = 0;
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
    cursor = next;
    total += keys.length;
  } while (cursor !== "0");
  return total;
}

export type SerpMetrics = {
  totalQueriesExecuted: number;
  completedBatches: number;
  failedBatches: number;
  /** Completed SERP batches (same universe as totalQueriesExecuted when all complete). */
  totalQueriesExecutedDb: number;
  /** Rows in SerpResult (post-filter URLs that were inserted). */
  totalInserted: number;
  /** Raw result count summed per query (in-process worker only; 0 in CLI snapshot). */
  totalResultsFetched: number;
  totalHighSignal: number;
  totalDeduped: number;
  queriesSkipped: number;
  avgResultsPerQuery: number;
  avgHighSignalPerQuery: number;
  serpEfficiency: number;
  dataNotes: string[];
};

export async function getSerpMetrics(
  prisma: PrismaClient,
  redis: Redis | null,
): Promise<SerpMetrics> {
  const notes: string[] = [
    "DB snapshot: totalInserted = SerpResult rows; avgResultsPerQuery uses completed batches as denominator.",
    "totalResultsFetched/totalHighSignal/totalDeduped merge in-process SERP worker counters (0 if workers not in this process).",
  ];

  const [totalQueriesExecuted, completedBatches, failedBatches, totalInsertedDb] = await Promise.all([
    prisma.serpBatch.count(),
    prisma.serpBatch.count({ where: { status: "completed" } }),
    prisma.serpBatch.count({ where: { status: "failed" } }),
    prisma.serpResult.count(),
  ]);

  let queriesSkipped = 0;
  if (redis) {
    try {
      queriesSkipped = await countRedisKeysByPrefix(redis, SERP_SKIP_KEY_PREFIX);
    } catch {
      notes.push("Redis scan for serp skip keys failed.");
    }
  } else {
    notes.push("Redis unavailable; queriesSkipped = 0.");
  }

  const proc = getSerpProcessCounters();
  const totalResultsFetched = Math.max(proc.totalResultsFetched, totalInsertedDb);
  const totalHighSignal = Math.max(proc.totalHighSignal, totalInsertedDb);
  const totalDeduped = proc.totalDeduped;
  const totalInserted = Math.max(proc.totalInserted, totalInsertedDb);

  const queryDen = completedBatches + proc.queriesCompleted;
  const avgResultsPerQuery = safeDiv(totalResultsFetched, queryDen);
  const avgHighSignalPerQuery = safeDiv(totalHighSignal, queryDen);
  const serpEfficiency = safeDiv(totalInserted, totalResultsFetched);

  return {
    totalQueriesExecuted,
    completedBatches,
    failedBatches,
    totalQueriesExecutedDb: completedBatches,
    totalInserted,
    totalResultsFetched,
    totalHighSignal,
    totalDeduped,
    queriesSkipped,
    avgResultsPerQuery,
    avgHighSignalPerQuery,
    serpEfficiency,
    dataNotes: notes,
  };
}

export type DiscoverySourceMetrics = {
  endpointsCreated: number;
  endpointsUpdated: number;
  endpointsSkipped: number;
  avgScore: number;
  discoveryEfficiency: number;
};

export type DiscoveryMetrics = {
  bySource: Record<MetricsSourceBucket, DiscoverySourceMetrics>;
  global: {
    endpointsTotal: number;
    discoveryEfficiency: number;
  };
  dataNotes: string[];
};

export async function getDiscoveryMetrics(prisma: PrismaClient): Promise<DiscoveryMetrics> {
  const notes = [
    "endpointsCreated/Updated: DB heuristic (created = first touch within 2m of createdAt; else updated).",
    "endpointsSkipped merges in-process discovery counters (duplicate/company/race); 0 in CLI snapshot.",
    "discoveryEfficiency = endpointsCreated / (endpointsCreated + endpointsSkipped).",
  ];

  const rows = await prisma.$queryRaw<
    {
      src: string;
      created: bigint;
      updated: bigint;
      total: bigint;
      avg_score: number | null;
    }[]
  >`
    SELECT
      CASE
        WHEN source = 'serp' THEN 'serp'
        WHEN source = 'job' THEN 'job'
        ELSE 'enrichment'
      END AS src,
      COUNT(*) FILTER (
        WHERE "updatedAt" <= "createdAt" + interval '2 minutes'
      )::bigint AS created,
      COUNT(*) FILTER (
        WHERE "updatedAt" > "createdAt" + interval '2 minutes'
      )::bigint AS updated,
      COUNT(*)::bigint AS total,
      AVG(score)::float AS avg_score
    FROM "AtsEndpoint"
    GROUP BY 1
  `;

  const empty: DiscoverySourceMetrics = {
    endpointsCreated: 0,
    endpointsUpdated: 0,
    endpointsSkipped: 0,
    avgScore: 0,
    discoveryEfficiency: 0,
  };

  const bySource: Record<MetricsSourceBucket, DiscoverySourceMetrics> = {
    serp: { ...empty },
    job: { ...empty },
    enrichment: { ...empty },
  };

  const proc = getDiscoveryProcessBySource();
  const rowBy = new Map(rows.map((r) => [r.src as MetricsSourceBucket, r]));

  let globalTotal = 0;
  let globalCreated = 0;
  let globalSkipped = 0;

  for (const bucket of Object.keys(bySource) as MetricsSourceBucket[]) {
    const r = rowBy.get(bucket);
    const p = proc[bucket];
    const createdDb = r ? Number(r.created) : 0;
    const updatedDb = r ? Number(r.updated) : 0;
    const totalDb = r ? Number(r.total) : 0;
    const created = Math.max(createdDb, p.endpointsCreated);
    const updated = updatedDb;
    const skipped = p.endpointsSkipped;
    bySource[bucket] = {
      endpointsCreated: created,
      endpointsUpdated: updated,
      endpointsSkipped: skipped,
      avgScore: r?.avg_score ?? 0,
      discoveryEfficiency: safeDiv(created, created + skipped),
    };
    globalTotal += totalDb;
    globalCreated += created;
    globalSkipped += skipped;
  }

  return {
    bySource,
    global: {
      endpointsTotal: globalTotal,
      discoveryEfficiency: safeDiv(globalCreated, globalCreated + globalSkipped),
    },
    dataNotes: notes,
  };
}

export type EndpointHealthSourceMetrics = {
  totalEndpoints: number;
  activeEndpoints: number;
  inactiveEndpoints: number;
  deadEndpoints: number;
  avgSuccessCount: number;
  avgFailureCount: number;
  healthScore: number;
};

export type EndpointHealthMetrics = {
  bySource: Record<MetricsSourceBucket, EndpointHealthSourceMetrics>;
  activationBreakdown: {
    scoreActivated: number;
    validationActivated: number;
    defaultActivated: number;
    otherActivated: number;
  };
  globalHealthScore: number;
  dataNotes: string[];
};

export async function getEndpointHealthMetrics(prisma: PrismaClient): Promise<EndpointHealthMetrics> {
  const notes = [
    "deadEndpoints = failureCount >= 10. healthScore = sum(success) / (sum(success)+sum(failure)) per bucket.",
    "activationBreakdown classifies all endpoints (not only active).",
  ];

  const eps = await prisma.atsEndpoint.findMany({
    select: {
      source: true,
      isActive: true,
      failureCount: true,
      successCount: true,
      score: true,
    },
  });

  const bySource: Record<MetricsSourceBucket, EndpointHealthSourceMetrics> = {
    serp: {
      totalEndpoints: 0,
      activeEndpoints: 0,
      inactiveEndpoints: 0,
      deadEndpoints: 0,
      avgSuccessCount: 0,
      avgFailureCount: 0,
      healthScore: 0,
    },
    job: {
      totalEndpoints: 0,
      activeEndpoints: 0,
      inactiveEndpoints: 0,
      deadEndpoints: 0,
      avgSuccessCount: 0,
      avgFailureCount: 0,
      healthScore: 0,
    },
    enrichment: {
      totalEndpoints: 0,
      activeEndpoints: 0,
      inactiveEndpoints: 0,
      deadEndpoints: 0,
      avgSuccessCount: 0,
      avgFailureCount: 0,
      healthScore: 0,
    },
  };

  const activationBreakdown = {
    scoreActivated: 0,
    validationActivated: 0,
    defaultActivated: 0,
    otherActivated: 0,
  };

  type Agg = {
    n: number;
    active: number;
    inactive: number;
    dead: number;
    sumSucc: number;
    sumFail: number;
  };
  const aggs: Record<MetricsSourceBucket, Agg> = {
    serp: { n: 0, active: 0, inactive: 0, dead: 0, sumSucc: 0, sumFail: 0 },
    job: { n: 0, active: 0, inactive: 0, dead: 0, sumSucc: 0, sumFail: 0 },
    enrichment: { n: 0, active: 0, inactive: 0, dead: 0, sumSucc: 0, sumFail: 0 },
  };

  let gSumSucc = 0;
  let gSumFail = 0;

  for (const ep of eps) {
    const bucket = normalizeEndpointMetricsSource(ep.source);
    const a = aggs[bucket];
    a.n += 1;
    if (ep.isActive) a.active += 1;
    else a.inactive += 1;
    if (ep.failureCount >= 10) a.dead += 1;
    a.sumSucc += ep.successCount;
    a.sumFail += ep.failureCount;
    gSumSucc += ep.successCount;
    gSumFail += ep.failureCount;

    const act = classifyEndpointActivation(ep);
    if (act === "score") activationBreakdown.scoreActivated += 1;
    else if (act === "validation") activationBreakdown.validationActivated += 1;
    else if (act === "default") activationBreakdown.defaultActivated += 1;
    else activationBreakdown.otherActivated += 1;
  }

  for (const key of Object.keys(aggs) as MetricsSourceBucket[]) {
    const a = aggs[key];
    bySource[key] = {
      totalEndpoints: a.n,
      activeEndpoints: a.active,
      inactiveEndpoints: a.inactive,
      deadEndpoints: a.dead,
      avgSuccessCount: safeDiv(a.sumSucc, a.n),
      avgFailureCount: safeDiv(a.sumFail, a.n),
      healthScore: safeDiv(a.sumSucc, a.sumSucc + a.sumFail),
    };
  }

  return {
    bySource,
    activationBreakdown,
    globalHealthScore: safeDiv(gSumSucc, gSumSucc + gSumFail),
    dataNotes: notes,
  };
}

export type IngestionSourceMetrics = {
  endpointsWithCrawlStamp: number;
  activeWithCrawlStamp: number;
  totalFetches: number;
  totalJobsFetched: number;
  totalJobsInserted: number;
  duplicatesSkipped: number;
  ingestionYield: number;
};

export type ProcessDedupSnapshot = {
  totalJobsIngested: number;
  canonicalJobsCreated: number;
  duplicateJobsDetected: number;
  dedupRate: number;
  avgDuplicatesPerCanonical: number;
};

export type IngestionMetrics = {
  bySource: Record<MetricsSourceBucket, IngestionSourceMetrics>;
  global: {
    totalJobs: number;
    totalCanonicalApprox: number;
    totalDuplicateRowsApprox: number;
    processDedupSnapshot: ProcessDedupSnapshot;
    ingestionYield: number;
    totalFetches: number;
    totalJobsFetched: number;
    totalJobsInserted: number;
    duplicatesSkipped: number;
  };
  dataNotes: string[];
};

export async function getIngestionMetrics(prisma: PrismaClient): Promise<IngestionMetrics> {
  const { getJobDedupMetricsSnapshot } = await import("./jobMetrics.service.js");

  const notes = [
    "endpointsWithCrawlStamp: AtsEndpoint rows with lastCrawledAt (validation or ingest touched).",
    "Per-source totalFetches/jobs* merge ats-endpoint worker in-process counters (ats_ingestion_started); 0 in CLI snapshot.",
    "Global ingestionYield uses job dedup service snapshot (worker process) when co-located.",
  ];

  const eps = await prisma.atsEndpoint.findMany({
    select: { source: true, lastCrawledAt: true, isActive: true },
  });

  const procIngest = getIngestionProcessBySource();

  const bySource: Record<MetricsSourceBucket, IngestionSourceMetrics> = {
    serp: {
      endpointsWithCrawlStamp: 0,
      activeWithCrawlStamp: 0,
      totalFetches: 0,
      totalJobsFetched: 0,
      totalJobsInserted: 0,
      duplicatesSkipped: 0,
      ingestionYield: 0,
    },
    job: {
      endpointsWithCrawlStamp: 0,
      activeWithCrawlStamp: 0,
      totalFetches: 0,
      totalJobsFetched: 0,
      totalJobsInserted: 0,
      duplicatesSkipped: 0,
      ingestionYield: 0,
    },
    enrichment: {
      endpointsWithCrawlStamp: 0,
      activeWithCrawlStamp: 0,
      totalFetches: 0,
      totalJobsFetched: 0,
      totalJobsInserted: 0,
      duplicatesSkipped: 0,
      ingestionYield: 0,
    },
  };

  for (const ep of eps) {
    if (ep.lastCrawledAt == null) continue;
    const b = normalizeEndpointMetricsSource(ep.source);
    bySource[b].endpointsWithCrawlStamp += 1;
    if (ep.isActive) bySource[b].activeWithCrawlStamp += 1;
  }

  for (const b of Object.keys(bySource) as MetricsSourceBucket[]) {
    const p = procIngest[b];
    bySource[b].totalFetches = p.totalFetches;
    bySource[b].totalJobsFetched = p.totalJobsFetched;
    bySource[b].totalJobsInserted = p.totalJobsInserted;
    bySource[b].duplicatesSkipped = p.duplicatesSkipped;
    bySource[b].ingestionYield = p.ingestionYield;
  }

  const [totalJobs, totalCanonicalApprox, totalDuplicateRowsApprox] = await Promise.all([
    prisma.job.count(),
    prisma.job.count({ where: { canonicalJobId: null } }),
    prisma.job.count({ where: { canonicalJobId: { not: null } } }),
  ]);

  const dedup = getJobDedupMetricsSnapshot();
  const ingestionYieldGlobal = safeDiv(dedup.canonicalJobsCreated, dedup.totalJobsIngested);

  let tf = 0;
  let tjf = 0;
  let tji = 0;
  let td = 0;
  for (const b of Object.keys(bySource) as MetricsSourceBucket[]) {
    tf += bySource[b].totalFetches;
    tjf += bySource[b].totalJobsFetched;
    tji += bySource[b].totalJobsInserted;
    td += bySource[b].duplicatesSkipped;
  }

  return {
    bySource,
    global: {
      totalJobs,
      totalCanonicalApprox,
      totalDuplicateRowsApprox,
      processDedupSnapshot: dedup,
      ingestionYield: ingestionYieldGlobal,
      totalFetches: tf,
      totalJobsFetched: tjf,
      totalJobsInserted: tji,
      duplicatesSkipped: td,
    },
    dataNotes: notes,
  };
}

export type WasteMetrics = {
  duplicateFetchRate: number;
  validationWaste: number;
  ingestionWaste: number;
  serpWaste: number;
  endpointsNeverValidated: number;
  duplicateFetchRecentSkips: number;
  duplicateFetchStarts: number;
  dataNotes: string[];
};

export async function getWasteMetrics(
  prisma: PrismaClient,
  redis: Redis | null,
): Promise<WasteMetrics> {
  const dupSkip = getIngestionDuplicateSkipTotals();
  const duplicateFetchDen = dupSkip.ingestionSkippedRecent + dupSkip.ingestionStarted;
  const duplicateFetchRate = safeDiv(dupSkip.ingestionSkippedRecent, duplicateFetchDen);

  const valProc = getValidationWasteCounters();
  const validationWasteDb = await prisma.atsEndpoint.count({
    where: {
      isActive: false,
      successCount: 0,
      failureCount: { gte: 1 },
    },
  });
  const validationWaste = Math.max(valProc.validationZeroJobs, validationWasteDb);

  const ingestionWaste = getIngestionWasteTotals().count;

  let serpWaste = 0;
  if (redis) {
    try {
      serpWaste = await countRedisKeysByPrefix(redis, SERP_SKIP_KEY_PREFIX);
    } catch {
      /* ignore */
    }
  }

  const endpointsNeverValidated = await prisma.atsEndpoint.count({
    where: { isActive: false, successCount: 0 },
  });

  const notes = [
    "duplicateFetchRate = ingestionSkippedRecent / (ingestionSkippedRecent + ingestionStarted) (in-process; recent-crawl backoff).",
    "validationWaste = max(process zero-job validations, DB inactive+failing endpoints).",
    "ingestionWaste = in-process count of ingest runs with jobsFetched>0 and zero inserted rows.",
    "serpWaste = Redis keys for queries marked dedupRatio > threshold (see SERP_SKIP_QUERY_DEDUP_RATIO).",
  ];

  return {
    duplicateFetchRate,
    validationWaste,
    ingestionWaste,
    serpWaste,
    endpointsNeverValidated,
    duplicateFetchRecentSkips: dupSkip.ingestionSkippedRecent,
    duplicateFetchStarts: dupSkip.ingestionStarted,
    dataNotes: notes,
  };
}

export type AtsMetricsSnapshot = {
  generatedAt: string;
  serp: SerpMetrics;
  discovery: DiscoveryMetrics;
  endpointHealth: EndpointHealthMetrics;
  ingestion: IngestionMetrics;
  waste: WasteMetrics;
};

export async function buildAtsMetricsSnapshot(
  prisma: PrismaClient,
  redis: Redis | null,
): Promise<AtsMetricsSnapshot> {
  const [serp, discovery, endpointHealth, ingestion, waste] = await Promise.all([
    getSerpMetrics(prisma, redis),
    getDiscoveryMetrics(prisma),
    getEndpointHealthMetrics(prisma),
    getIngestionMetrics(prisma),
    getWasteMetrics(prisma, redis),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    serp,
    discovery,
    endpointHealth,
    ingestion,
    waste,
  };
}
