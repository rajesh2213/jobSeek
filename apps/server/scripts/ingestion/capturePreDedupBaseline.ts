/**
 * Phase 0 — pre-dedup safety snapshot (read-only).
 * Run: npx tsx scripts/ingestion/capturePreDedupBaseline.ts
 */
import { writeFileSync } from "node:fs";
import { Queue } from "bullmq";
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";
import { getRedisConnection } from "../../src/queues/job.queue.js";
import { INGEST_ATS_ENDPOINT_QUEUE_NAME } from "../../src/queues/ats-endpoint.queue.js";
import { buildCompanyCoverageStats } from "../../src/services/companyCoverage.service.js";

const OUT_PATH = "/tmp/pre-dedup-baseline.json";

async function main(): Promise<void> {
  loadRootEnv();

  const queue = new Queue(INGEST_ATS_ENDPOINT_QUEUE_NAME, { connection: getRedisConnection() });
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
    for (const j of page) {
      const eid = (j.data as { endpointId?: string })?.endpointId;
      if (eid) endpointIds.add(eid);
    }
    start += pageSize;
  }
  await queue.close();

  const [crawled24h, activeJobs, coverage] = await Promise.all([
    prisma.$queryRaw<[{ c: number }]>`
      SELECT COUNT(*)::int AS c FROM "AtsEndpoint"
      WHERE "isActive" = true AND "lastCrawledAt" >= NOW() - INTERVAL '24 hours'
    `,
    prisma.$queryRaw<[{ c: number }]>`
      SELECT COUNT(*)::int AS c FROM "Job" WHERE status = 'ready' AND "isActive" = true
    `,
    buildCompanyCoverageStats(prisma),
  ]);

  const baseline = {
    capturedAt: new Date().toISOString(),
    queue: {
      waiting,
      active,
      delayed,
      failed,
      uniqueEndpointIdsInWaiting: endpointIds.size,
      uniqueEndpointIds: [...endpointIds].sort(),
      duplicateRatio: endpointIds.size > 0 ? Number((waiting / endpointIds.size).toFixed(2)) : 0,
    },
    endpointsCrawledLast24h: Number(crawled24h[0]?.c ?? 0),
    activeHiringCompanies: coverage.activeHiringCompanies,
    activeJobs: Number(activeJobs[0]?.c ?? 0),
  };

  writeFileSync(OUT_PATH, JSON.stringify(baseline, null, 2));
  console.log(JSON.stringify(baseline, null, 2));
  await prisma.$disconnect();
}

void main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exitCode = 1;
});
