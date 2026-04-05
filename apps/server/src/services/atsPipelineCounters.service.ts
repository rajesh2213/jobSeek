/**
 * In-process ATS pipeline counters (worker lifetime). Snapshot CLI merges with Prisma;
 * values are 0 when no worker has run in-process.
 */

import {
  type MetricsSourceBucket,
  normalizeEndpointMetricsSource,
} from "./atsMetrics.types.js";

function emptySourceAgg(): SourceAgg {
  return {
    endpointsCreated: 0,
    endpointsSkippedDuplicate: 0,
    endpointsSkippedCompany: 0,
    endpointsSkippedRace: 0,
    ingestionStarted: 0,
    ingestionSkippedRecent: 0,
    ingestionJobsFetched: 0,
    ingestionJobsInsertedRows: 0,
    ingestionDupSkipped: 0,
    ingestionWasteFetchedNoInsert: 0,
  };
}

type SourceAgg = {
  endpointsCreated: number;
  endpointsSkippedDuplicate: number;
  endpointsSkippedCompany: number;
  endpointsSkippedRace: number;
  ingestionStarted: number;
  ingestionSkippedRecent: number;
  ingestionJobsFetched: number;
  ingestionJobsInsertedRows: number;
  ingestionDupSkipped: number;
  ingestionWasteFetchedNoInsert: number;
};

const discoveryBySource: Record<MetricsSourceBucket, SourceAgg> = {
  serp: emptySourceAgg(),
  job: emptySourceAgg(),
  enrichment: emptySourceAgg(),
};

let serpQueriesCompletedProcess = 0;
let serpTotalRawResultsFetched = 0;
let serpTotalHighSignal = 0;
let serpTotalInserted = 0;
let serpTotalDeduped = 0;

let validationRuns = 0;
let validationZeroJobs = 0;

export type DiscoveryPersistenceOutcome =
  | "created"
  | "skipped_duplicate"
  | "skipped_company_limit"
  | "skipped_race_duplicate";

export function recordSerpQueryPipelineTotals(args: {
  totalResults: number;
  highSignal: number;
  inserted: number;
  deduped: number;
}): void {
  serpQueriesCompletedProcess += 1;
  serpTotalRawResultsFetched += Math.max(0, args.totalResults);
  serpTotalHighSignal += Math.max(0, args.highSignal);
  serpTotalInserted += Math.max(0, args.inserted);
  serpTotalDeduped += Math.max(0, args.deduped);
}

export function getSerpProcessCounters(): {
  queriesCompleted: number;
  totalResultsFetched: number;
  totalHighSignal: number;
  totalInserted: number;
  totalDeduped: number;
} {
  return {
    queriesCompleted: serpQueriesCompletedProcess,
    totalResultsFetched: serpTotalRawResultsFetched,
    totalHighSignal: serpTotalHighSignal,
    totalInserted: serpTotalInserted,
    totalDeduped: serpTotalDeduped,
  };
}

export function recordDiscoveryPersistence(
  source: "serp" | "job" | "enrichment",
  outcome: DiscoveryPersistenceOutcome,
): void {
  const b = source as MetricsSourceBucket;
  const a = discoveryBySource[b];
  if (outcome === "created") a.endpointsCreated += 1;
  else if (outcome === "skipped_duplicate") a.endpointsSkippedDuplicate += 1;
  else if (outcome === "skipped_company_limit") a.endpointsSkippedCompany += 1;
  else if (outcome === "skipped_race_duplicate") a.endpointsSkippedRace += 1;
}

export function getDiscoveryProcessBySource(): Record<
  MetricsSourceBucket,
  {
    endpointsCreated: number;
    endpointsSkipped: number;
  }
> {
  const out = {} as Record<
    MetricsSourceBucket,
    { endpointsCreated: number; endpointsSkipped: number }
  >;
  for (const key of Object.keys(discoveryBySource) as MetricsSourceBucket[]) {
    const a = discoveryBySource[key];
    const skipped =
      a.endpointsSkippedDuplicate + a.endpointsSkippedCompany + a.endpointsSkippedRace;
    out[key] = {
      endpointsCreated: a.endpointsCreated,
      endpointsSkipped: skipped,
    };
  }
  return out;
}

export function recordAtsIngestionStarted(endpointSource: string): void {
  const b = normalizeEndpointMetricsSource(endpointSource);
  discoveryBySource[b].ingestionStarted += 1;
}

export function recordAtsIngestionSkippedRecent(endpointSource: string): void {
  const b = normalizeEndpointMetricsSource(endpointSource);
  discoveryBySource[b].ingestionSkippedRecent += 1;
}

export function recordAtsIngestionOutcome(
  endpointSource: string,
  args: {
    jobsFetched: number;
    jobsInsertedRows: number;
    dupSkipped: number;
  },
): void {
  const b = normalizeEndpointMetricsSource(endpointSource);
  const a = discoveryBySource[b];
  a.ingestionJobsFetched += args.jobsFetched;
  a.ingestionJobsInsertedRows += args.jobsInsertedRows;
  a.ingestionDupSkipped += args.dupSkipped;
  if (args.jobsFetched > 0 && args.jobsInsertedRows === 0) {
    a.ingestionWasteFetchedNoInsert += 1;
  }
}

export function getIngestionProcessBySource(): Record<
  MetricsSourceBucket,
  {
    totalFetches: number;
    totalJobsFetched: number;
    totalJobsInserted: number;
    duplicatesSkipped: number;
    ingestionYield: number;
  }
> {
  const out = {} as Record<
    MetricsSourceBucket,
    {
      totalFetches: number;
      totalJobsFetched: number;
      totalJobsInserted: number;
      duplicatesSkipped: number;
      ingestionYield: number;
    }
  >;
  for (const key of Object.keys(discoveryBySource) as MetricsSourceBucket[]) {
    const a = discoveryBySource[key];
    const fetched = a.ingestionJobsFetched;
    const inserted = a.ingestionJobsInsertedRows;
    out[key] = {
      totalFetches: a.ingestionStarted,
      totalJobsFetched: fetched,
      totalJobsInserted: inserted,
      duplicatesSkipped: a.ingestionDupSkipped,
      ingestionYield: fetched === 0 ? 0 : inserted / fetched,
    };
  }
  return out;
}

/** Counts validation attempts where the crawler returned zero jobs (includes errors and zero_jobs). */
export function recordValidationPipeline(jobsFetched: number): void {
  validationRuns += 1;
  if (jobsFetched === 0) validationZeroJobs += 1;
}

export function getValidationWasteCounters(): {
  validationRuns: number;
  validationZeroJobs: number;
} {
  return { validationRuns, validationZeroJobs };
}

export function getIngestionDuplicateSkipTotals(): {
  ingestionStarted: number;
  ingestionSkippedRecent: number;
} {
  let started = 0;
  let skipped = 0;
  for (const key of Object.keys(discoveryBySource) as MetricsSourceBucket[]) {
    const a = discoveryBySource[key];
    started += a.ingestionStarted;
    skipped += a.ingestionSkippedRecent;
  }
  return { ingestionStarted: started, ingestionSkippedRecent: skipped };
}

export function getIngestionWasteTotals(): { count: number } {
  let n = 0;
  for (const key of Object.keys(discoveryBySource) as MetricsSourceBucket[]) {
    n += discoveryBySource[key].ingestionWasteFetchedNoInsert;
  }
  return { count: n };
}
