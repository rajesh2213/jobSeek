/**
 * Phase 0 — read-only production baseline (queues + DB slices + env hints).
 * Run: cd apps/server && npx tsx scripts/ingestion/captureBaseline.ts
 * Outputs JSON to stdout (redirect to file for BEFORE snapshot).
 */
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";
import { getIoredis } from "../../src/queues/job.queue.js";
import { buildIngestionObservabilitySnapshot } from "../../src/services/ingestionObservability.service.js";

loadRootEnv();

void (async () => {
  const redis = getIoredis();
  const snapshot = await buildIngestionObservabilitySnapshot(prisma, redis);
  const baseline = {
    capturedAt: new Date().toISOString(),
    snapshot,
    envHints: {
      METRICS_SNAPSHOT_SEQUENTIAL: process.env.METRICS_SNAPSHOT_SEQUENTIAL ?? null,
      ATS_ENDPOINT_WORKER_CONCURRENCY: process.env.ATS_ENDPOINT_WORKER_CONCURRENCY ?? null,
      ATS_ENDPOINT_SCHEDULER_MAX_PER_TYPE: process.env.ATS_ENDPOINT_SCHEDULER_MAX_PER_TYPE ?? null,
      SERP_SCHEDULER_INTERVAL_MS: process.env.SERP_SCHEDULER_INTERVAL_MS ?? null,
      JOB_STATUS_RECONCILE_LONG_DESC_READY: process.env.JOB_STATUS_RECONCILE_LONG_DESC_READY ?? null,
    },
  };
  console.log(JSON.stringify(baseline, null, 2));
  await prisma.$disconnect();
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
