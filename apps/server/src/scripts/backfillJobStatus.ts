/**
 * One-time backfill for `Job.status` with CAS guards so live ingestion decisions are never overwritten.
 *
 * Run:
 *   npm run backfill:job-status -w @jobseek/server
 *   npm run backfill:job-status -w @jobseek/server -- --dry-run
 *   npm run backfill:job-status -w @jobseek/server -- --batch-size 250 --max-batches 20
 */
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { logger } from "../utils/logger.js";
import { Prisma } from "@prisma/client";

type CliArgs = {
  dryRun: boolean;
  batchSize: number;
  maxBatches: number;
  sampleSize: number;
};

type Row = {
  id: string;
  status: string | null;
  title: string;
  description: string | null;
  parsedDescription: unknown;
};

type BucketTotals = {
  ready: number;
  processing: number;
  failed: number;
  null: number;
};

const DEFAULT_BATCH_SIZE = 250;
const DEFAULT_MAX_BATCHES = 100_000;
const DEFAULT_SAMPLE_SIZE = 8;

function parseArgs(argv: string[]): CliArgs {
  let dryRun = false;
  let batchSize = DEFAULT_BATCH_SIZE;
  let maxBatches = DEFAULT_MAX_BATCHES;
  let sampleSize = DEFAULT_SAMPLE_SIZE;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (token === "--batch-size") {
      const n = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isFinite(n) || n < 100 || n > 500) {
        throw new Error("Invalid --batch-size. Expected integer between 100 and 500.");
      }
      batchSize = n;
      continue;
    }
    if (token === "--max-batches") {
      const n = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isFinite(n) || n < 1) {
        throw new Error("Invalid --max-batches. Expected positive integer.");
      }
      maxBatches = n;
      continue;
    }
    if (token === "--sample-size") {
      const n = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isFinite(n) || n < 1 || n > 50) {
        throw new Error("Invalid --sample-size. Expected integer between 1 and 50.");
      }
      sampleSize = n;
      continue;
    }
    if (token.startsWith("-")) {
      throw new Error(`Unknown flag: ${token}`);
    }
  }

  return { dryRun, batchSize, maxBatches, sampleSize };
}

function normalizeDescription(description: string | null | undefined): string {
  return (description ?? "").replace(/\s+/g, " ").trim();
}

function isReadyByRule(row: Pick<Row, "title" | "description" | "parsedDescription">): boolean {
  if (row.parsedDescription != null) return true;
  const hasTitle = row.title.trim().length > 0;
  if (!hasTitle) return false;
  const desc = normalizeDescription(row.description);
  return desc.length > 100;
}

async function readStatusBuckets(): Promise<BucketTotals> {
  const rows = await prisma.$queryRaw<Array<{ status: string | null; c: bigint }>>`
    SELECT "status", COUNT(*)::bigint AS c
    FROM "Job"
    GROUP BY "status"
  `;
  const totals: BucketTotals = { ready: 0, processing: 0, failed: 0, null: 0 };
  for (const row of rows) {
    const count = Number(row.c);
    if (row.status === null) totals.null += count;
    else if (row.status === "ready") totals.ready += count;
    else if (row.status === "processing") totals.processing += count;
    else if (row.status === "failed") totals.failed += count;
  }
  return totals;
}

async function countProcessingRows(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ c: bigint }>>`
    SELECT COUNT(*)::bigint AS c
    FROM "Job"
    WHERE "status" = 'processing'
  `;
  return Number(rows[0]?.c ?? 0n);
}

async function fetchProcessingRows(lastId: string, limit: number): Promise<Row[]> {
  const lastIdCond = lastId
    ? Prisma.sql`AND id > ${lastId}`
    : Prisma.sql``;
  return prisma.$queryRaw<Row[]>`
    SELECT id, "status", title, description, "parsedDescription"
    FROM "Job"
    WHERE "status" = 'processing'
    ${lastIdCond}
    ORDER BY id ASC
    LIMIT ${limit}
  `;
}

async function markReadyIfStillProcessing(id: string): Promise<number> {
  const updated = await prisma.$executeRaw`
    UPDATE "Job"
    SET "status" = 'ready'
    WHERE id = ${id}
      AND "status" = 'processing'
  `;
  return Number(updated);
}

async function main(): Promise<void> {
  loadRootEnv();
  const startedAt = Date.now();
  const args = parseArgs(process.argv.slice(2));

  const beforeBuckets = await readStatusBuckets();
  const targetCount = await countProcessingRows();
  const assumedRowsPerSecond = 300;
  const estimatedSeconds = Math.ceil(targetCount / assumedRowsPerSecond);

  logger.info(
    {
      event: "backfill_job_status_start",
      dryRun: args.dryRun,
      batchSize: args.batchSize,
      maxBatches: args.maxBatches,
      targetRows: targetCount,
      statusBucketsBefore: beforeBuckets,
      estimatedSeconds,
      estimationAssumptionRowsPerSecond: assumedRowsPerSecond,
    },
    "backfill_job_status_start",
  );

  let lastId = "";
  let batches = 0;
  let processed = 0;
  let updatedReady = 0;
  let updatedProcessing = 0;
  let skipped = 0;
  let failed = 0;
  const sampleReady: string[] = [];
  const sampleProcessing: string[] = [];
  const sampleFailedSkipped: string[] = [];

  while (batches < args.maxBatches) {
    const rows = await fetchProcessingRows(lastId, args.batchSize);

    if (rows.length === 0) break;
    batches += 1;
    const batchStartedAt = Date.now();

    for (const row of rows as Row[]) {
      lastId = row.id;
      processed += 1;

      const nextReady = isReadyByRule(row);
      if (!nextReady) {
        if (sampleProcessing.length < args.sampleSize) sampleProcessing.push(row.id);
        if (row.status === "processing") {
          skipped += 1;
          continue;
        }
      } else if (sampleReady.length < args.sampleSize) {
        sampleReady.push(row.id);
      }

      if (args.dryRun) {
        if (nextReady) updatedReady += 1;
        else updatedProcessing += 1;
        continue;
      }

      try {
        if (nextReady) {
          const updated = await markReadyIfStillProcessing(row.id);
          if (updated > 0) updatedReady += 1;
          else skipped += 1;
        } else {
          skipped += 1;
        }
      } catch (err) {
        failed += 1;
        if (sampleFailedSkipped.length < args.sampleSize) sampleFailedSkipped.push(row.id);
        logger.error({ event: "backfill_job_status_row_failed", jobId: row.id, err }, "backfill_job_status_row_failed");
      }
    }

    const elapsedMs = Date.now() - startedAt;
    const rate = processed > 0 ? processed / (elapsedMs / 1000) : 0;
    const remainingRows = Math.max(targetCount - processed, 0);
    const etaSeconds = rate > 0 ? Math.ceil(remainingRows / rate) : null;
    const batchMs = Date.now() - batchStartedAt;
    logger.info(
      {
        event: "backfill_job_status_progress",
        batch: batches,
        batchRows: rows.length,
        batchDurationMs: batchMs,
        processed,
        updatedReady,
        updatedProcessing,
        skipped,
        failed,
        etaSeconds,
      },
      "backfill_job_status_progress",
    );
  }

  const afterBuckets = await readStatusBuckets();
  const durationMs = Date.now() - startedAt;
  const summary = {
    dryRun: args.dryRun,
    batches,
    processed,
    updatedReady,
    updatedProcessing,
    skipped,
    failed,
    statusBucketsBefore: beforeBuckets,
    statusBucketsAfter: afterBuckets,
    sampleWillBeReady: sampleReady,
    sampleWillBeProcessing: sampleProcessing,
    sampleFailedOrSkipped: sampleFailedSkipped,
    durationMs,
  };

  logger.info({ event: "backfill_job_status_done", ...summary }, "backfill_job_status_done");
}

main()
  .catch((err) => {
    logger.error({ event: "backfill_job_status_failed", err }, "backfill_job_status_failed");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
