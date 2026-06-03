/**
 * One-shot repair: floor scores for active OpenClaw endpoints and enqueue recrawls.
 * Safe to re-run (idempotent score floor + fresh jobIds).
 */
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import {
  applyOpenClawActiveScoreFloor,
  openClawActiveMinScore,
  OPENCLAW_SOURCE,
} from "../modules/atsEndpoint/openClawActiveScore.js";
import {
  closeIngestAtsEndpointQueue,
  getIngestAtsEndpointQueue,
  INGEST_ATS_ENDPOINT_JOB,
} from "../queues/ats-endpoint.queue.js";

async function main(): Promise<void> {
  loadRootEnv();
  const minScore = openClawActiveMinScore();
  const rows = await prisma.atsEndpoint.findMany({
    where: { source: OPENCLAW_SOURCE, isActive: true },
    select: { id: true, slug: true, score: true, lastCrawledAt: true },
  });

  if (rows.length === 0) {
    console.log(JSON.stringify({ message: "no_active_openclaw_endpoints", minScore }));
    return;
  }

  const scoreUpdates: { id: string; slug: string; oldScore: number; newScore: number }[] = [];
  for (const row of rows) {
    const newScore = applyOpenClawActiveScoreFloor(row.score, OPENCLAW_SOURCE, true);
    if (newScore !== row.score) {
      await prisma.atsEndpoint.update({
        where: { id: row.id },
        data: { score: newScore },
      });
      scoreUpdates.push({ id: row.id, slug: row.slug, oldScore: row.score, newScore });
    }
  }

  const queue = getIngestAtsEndpointQueue();
  const enqueued: { id: string; jobId: string }[] = [];
  for (const row of rows) {
    const job = await queue.add(
      INGEST_ATS_ENDPOINT_JOB,
      { endpointId: row.id },
      { jobId: `openclaw-repair-${row.id}-${Date.now()}`, attempts: 1 },
    );
    enqueued.push({ id: row.id, jobId: job.id ?? "unknown" });
  }
  await closeIngestAtsEndpointQueue();
  await prisma.$disconnect();

  console.log(
    JSON.stringify(
      {
        minScore,
        active_count: rows.length,
        score_updates: scoreUpdates,
        enqueued,
      },
      null,
      2,
    ),
  );
}

void main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
