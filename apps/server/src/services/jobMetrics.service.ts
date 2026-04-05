/**
 * In-process dedup / ingestion observability (counters + structured logs).
 * For multi-instance deployments, aggregate via log pipeline or replace with Prometheus.
 */

let totalJobsIngested = 0;
let canonicalJobsCreated = 0;
let duplicateJobsDetected = 0;

export function resetJobMetrics(): void {
  totalJobsIngested = 0;
  canonicalJobsCreated = 0;
  duplicateJobsDetected = 0;
}

export type IngestionOutcomeKind =
  | "idempotent"
  | "canonical_new"
  | "duplicate_merged";

export function recordIngestionOutcome(kind: IngestionOutcomeKind): void {
  totalJobsIngested += 1;
  if (kind === "canonical_new") canonicalJobsCreated += 1;
  if (kind === "duplicate_merged") duplicateJobsDetected += 1;
}

export function getJobDedupMetricsSnapshot(): {
  totalJobsIngested: number;
  canonicalJobsCreated: number;
  duplicateJobsDetected: number;
  dedupRate: number;
  avgDuplicatesPerCanonical: number;
} {
  const dedupRate =
    totalJobsIngested === 0 ? 0 : duplicateJobsDetected / totalJobsIngested;
  const avgDuplicatesPerCanonical =
    canonicalJobsCreated === 0 ? 0 : duplicateJobsDetected / canonicalJobsCreated;

  return {
    totalJobsIngested,
    canonicalJobsCreated,
    duplicateJobsDetected,
    dedupRate,
    avgDuplicatesPerCanonical,
  };
}
