/**
 * Blocker 5 — temporary duplicate-ratio monitoring for ingest-ats-endpoint queue.
 *
 * duplicate_ratio = waiting_jobs / unique_endpoint_ids_waiting
 *
 * Exit codes:
 *   0 — OK (ratio <= 2)
 *   1 — WARN (ratio > 2 and <= 5)
 *   2 — CRITICAL (ratio > 5)
 *
 * Run:
 *   cd apps/server && npx tsx scripts/ingestion/atsEndpointQueueDuplicateRatio.ts
 */
import { Queue } from "bullmq";
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { getRedisConnection } from "../../src/queues/job.queue.js";
import { INGEST_ATS_ENDPOINT_QUEUE_NAME } from "../../src/queues/ats-endpoint.queue.js";

const WARN_THRESHOLD = 2;
const CRITICAL_THRESHOLD = 5;

async function main(): Promise<void> {
  loadRootEnv();

  const queue = new Queue(INGEST_ATS_ENDPOINT_QUEUE_NAME, { connection: getRedisConnection() });
  try {
    const [waiting, active, delayed, failed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getDelayedCount(),
      queue.getFailedCount(),
    ]);

    const endpointIds = new Set<string>();
    const pageSize = 500;
    let start = 0;
    while (start < waiting) {
      const end = Math.min(start + pageSize - 1, waiting - 1);
      const page = await queue.getJobs(["waiting"], start, end, true);
      if (page.length === 0) break;
      for (const job of page) {
        const eid = (job.data as { endpointId?: string })?.endpointId;
        if (eid) endpointIds.add(eid);
      }
      start += pageSize;
    }

    const uniqueEndpoints = endpointIds.size;
    const duplicateRatio =
      uniqueEndpoints > 0 ? Number((waiting / uniqueEndpoints).toFixed(2)) : waiting > 0 ? waiting : 0;

    let severity: "OK" | "WARN" | "CRITICAL" = "OK";
    let exitCode = 0;
    if (duplicateRatio > CRITICAL_THRESHOLD) {
      severity = "CRITICAL";
      exitCode = 2;
    } else if (duplicateRatio > WARN_THRESHOLD) {
      severity = "WARN";
      exitCode = 1;
    }

    const report = {
      capturedAt: new Date().toISOString(),
      queue: INGEST_ATS_ENDPOINT_QUEUE_NAME,
      waiting,
      active,
      delayed,
      failed,
      uniqueEndpoints,
      duplicateRatio,
      thresholds: { warn: WARN_THRESHOLD, critical: CRITICAL_THRESHOLD },
      severity,
    };

    console.log(JSON.stringify(report, null, 2));
    process.exitCode = exitCode;
  } finally {
    await queue.close();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exitCode = 3;
});
