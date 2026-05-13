import { Prisma } from "@prisma/client";
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { deriveExperienceLevel } from "../utils/taxonomyNormalizer.js";

type Args = {
  batchSize: number;
  sleepMs: number;
  maxBatches: number;
  dryRun: boolean;
  checkpoint: string | null;
  /** When true, re-derive even rows that already have a non-null experienceLevel. */
  force: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    batchSize: 500,
    sleepMs: 200,
    maxBatches: 10,
    dryRun: true,
    checkpoint: null,
    force: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--batch-size") out.batchSize = Number(argv[i + 1] ?? out.batchSize);
    if (arg === "--sleep-ms") out.sleepMs = Number(argv[i + 1] ?? out.sleepMs);
    if (arg === "--max-batches") out.maxBatches = Number(argv[i + 1] ?? out.maxBatches);
    if (arg === "--apply") out.dryRun = false;
    if (arg === "--force") out.force = true;
    if (arg === "--checkpoint") out.checkpoint = String(argv[i + 1] ?? "").trim() || null;
  }
  out.batchSize = Math.max(50, Math.min(2000, Math.floor(out.batchSize)));
  out.sleepMs = Math.max(0, Math.min(10000, Math.floor(out.sleepMs)));
  out.maxBatches = Math.max(1, Math.min(100000, Math.floor(out.maxBatches)));
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logProgress(payload: Record<string, unknown>): void {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: "backfill_experience_level_progress",
      ...payload,
    }),
  );
}

async function checkpointGet(key: string): Promise<string | null> {
  const row = await prisma.$queryRaw<Array<{ value: string }>>`
    SELECT "value" FROM "BackfillCheckpoint" WHERE "key" = ${key} LIMIT 1
  `;
  return row[0]?.value ?? null;
}

async function checkpointSet(key: string, value: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "BackfillCheckpoint" ("key", "value", "updatedAt")
    VALUES (${key}, ${value}, NOW())
    ON CONFLICT ("key") DO UPDATE
    SET "value" = EXCLUDED."value", "updatedAt" = NOW()
  `;
}

async function ensureCheckpointTable(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BackfillCheckpoint" (
      "key" TEXT PRIMARY KEY,
      "value" TEXT NOT NULL,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
    )
  `);
}

const CHECKPOINT_KEY = "experience_level:last_id";

async function run(args: Args): Promise<{ scanned: number; updated: number; skipped: number; batches: number }> {
  let cursor = args.checkpoint ?? (await checkpointGet(CHECKPOINT_KEY)) ?? "";
  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let batches = 0;
  const runStarted = Date.now();

  while (batches < args.maxBatches) {
    const batchStarted = Date.now();
    const rows = await prisma.job.findMany({
      where: {
        id: cursor ? { gt: cursor } : undefined,
        ...(args.force ? {} : { experienceLevel: null }),
      },
      orderBy: { id: "asc" },
      take: args.batchSize,
      select: { id: true, title: true, experienceLevel: true },
    });
    if (rows.length === 0) break;

    batches += 1;
    scanned += rows.length;
    let updatedThisBatch = 0;

    for (const row of rows) {
      const derived = deriveExperienceLevel(row.title);

      if (derived === null || (!args.force && derived === row.experienceLevel)) {
        skipped += 1;
        cursor = row.id;
        continue;
      }

      updated += 1;
      updatedThisBatch += 1;

      if (!args.dryRun) {
        await prisma.job.update({
          where: { id: row.id },
          data: { experienceLevel: derived } satisfies Prisma.JobUpdateInput,
        });
      }
      cursor = row.id;
    }

    if (!args.dryRun && cursor) await checkpointSet(CHECKPOINT_KEY, cursor);

    const batchMs = Date.now() - batchStarted;
    const elapsedSec = (Date.now() - runStarted) / 1000;
    const rowsPerSec = batchMs > 0 ? rows.length / (batchMs / 1000) : null;
    const batchesRemaining = Math.max(0, args.maxBatches - batches);
    const etaSec =
      batchesRemaining > 0 && batchMs > 0 ? (batchesRemaining * (batchMs + args.sleepMs)) / 1000 : 0;

    logProgress({
      phase: "batch_done",
      dryRun: args.dryRun,
      batch: batches,
      maxBatches: args.maxBatches,
      rowsThisBatch: rows.length,
      updatedThisBatch,
      cumulativeScanned: scanned,
      cumulativeUpdated: updated,
      cumulativeSkipped: skipped,
      checkpoint: cursor,
      batchDurationMs: batchMs,
      rowsPerSec: rowsPerSec != null ? Number(rowsPerSec.toFixed(2)) : null,
      elapsedSec: Number(elapsedSec.toFixed(2)),
      etaRemainingSec: batchesRemaining ? Number(etaSec.toFixed(1)) : 0,
    });

    if (args.sleepMs > 0) await sleep(args.sleepMs);
  }

  return { scanned, updated, skipped, batches };
}

async function main(): Promise<void> {
  loadRootEnv();
  const args = parseArgs(process.argv.slice(2));
  await ensureCheckpointTable();

  const result = await run(args);

  console.log(
    JSON.stringify(
      {
        dryRun: args.dryRun,
        batchSize: args.batchSize,
        sleepMs: args.sleepMs,
        maxBatches: args.maxBatches,
        force: args.force,
        ...result,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
