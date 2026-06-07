/**
 * Repair + optional activation for OpenClaw ATS boards.
 * - Floors scores for active openclaw endpoints
 * - Enqueues recrawls with unique jobIds (safe to re-run)
 * - Optional: OPENCLAW_ACTIVATE_ENDPOINT_ID activates one inactive board first
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

async function activateOpenClawEndpoint(
  endpointId: string,
): Promise<{ id: string; slug: string; score: number } | null> {
  const before = await prisma.atsEndpoint.findUnique({
    where: { id: endpointId },
    select: { id: true, slug: true, source: true, isActive: true, score: true },
  });
  if (!before) throw new Error(`endpoint not found: ${endpointId}`);
  if (before.source !== OPENCLAW_SOURCE) throw new Error("refusing: not openclaw source");
  if (before.isActive) return { id: before.id, slug: before.slug, score: before.score };

  const score = applyOpenClawActiveScoreFloor(before.score, OPENCLAW_SOURCE, true);
  const updated = await prisma.atsEndpoint.updateMany({
    where: { id: endpointId, source: OPENCLAW_SOURCE, isActive: false },
    data: { isActive: true, score },
  });
  if (updated.count !== 1) throw new Error(`activation updated ${updated.count} rows`);

  return { id: before.id, slug: before.slug, score };
}

async function main(): Promise<void> {
  loadRootEnv();
  const minScore = openClawActiveMinScore();
  const activateId = process.env.OPENCLAW_ACTIVATE_ENDPOINT_ID?.trim();

  let activated: { id: string; slug: string; score: number } | null = null;
  if (activateId) {
    activated = await activateOpenClawEndpoint(activateId);
  }

  const rows = await prisma.atsEndpoint.findMany({
    where: { source: OPENCLAW_SOURCE, isActive: true },
    select: { id: true, slug: true, score: true, lastCrawledAt: true },
  });

  if (rows.length === 0) {
    console.log(JSON.stringify({ message: "no_active_openclaw_endpoints", minScore, activated }));
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
        activated,
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
