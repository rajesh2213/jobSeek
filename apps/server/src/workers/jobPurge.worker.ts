import { Worker } from "bullmq";
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { logger } from "../utils/logger.js";
import { assertWorkerProcessEnv } from "../infrastructure/env/validateWorkerEnv.js";
import { registerWorkerShutdown } from "../utils/workerShutdown.js";
import {
  closeJobPurgeQueue,
  JOB_PURGE_QUEUE_NAME,
  JOB_PURGE_TICK,
} from "../queues/jobPurge.queue.js";
import { getRedisConnection } from "../queues/job.queue.js";

const DEFAULT_BATCH_SIZE = 1000;
const DEFAULT_MAX_ROWS_PER_RUN = 5000;
const FRESH_BUFFER_DAYS = 3;

function boolEnv(name: string): boolean {
  return process.env[name]?.trim() === "true";
}

function numberEnv(name: string, fallback: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

const BATCH_SIZE = numberEnv("JOB_PURGE_BATCH_SIZE", DEFAULT_BATCH_SIZE, 2000);
const MAX_ROWS_PER_RUN = numberEnv("JOB_PURGE_MAX_ROWS_PER_RUN", DEFAULT_MAX_ROWS_PER_RUN, 10000);
const DRY_RUN = boolEnv("JOB_PURGE_DRY_RUN");

async function currentDbSizeBytes(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ size_bytes: bigint }>>`
    SELECT pg_database_size(current_database()) AS size_bytes
  `;
  return Number(rows[0]?.size_bytes ?? 0n);
}

async function markExpiredInactiveBatch(limit: number): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH target AS (
      SELECT id
      FROM "Job"
      WHERE "isActive" = true
        AND "expiresAt" IS NOT NULL
        AND "expiresAt" < now()
      ORDER BY "expiresAt" ASC
      LIMIT ${limit}
    )
    UPDATE "Job" AS j
    SET "isActive" = false
    FROM target
    WHERE j.id = target.id
    RETURNING j.id
  `;
  return rows.length;
}

async function duplicateDeleteBatch(dryRun: boolean, limit: number): Promise<number> {
  if (dryRun) {
    const rows = await prisma.$queryRaw<Array<{ c: bigint }>>`
      WITH target AS (
        SELECT id
        FROM "Job"
        WHERE "canonicalJobId" IS NOT NULL
          AND "createdAt" < now() - (${FRESH_BUFFER_DAYS} * interval '1 day')
          AND (
            ("expiresAt" IS NOT NULL AND "expiresAt" < now())
            OR "lastSeenAt" < now() - interval '14 days'
          )
        ORDER BY "lastSeenAt" ASC NULLS FIRST
        LIMIT ${limit}
      )
      SELECT COUNT(*)::bigint AS c FROM target
    `;
    return Number(rows[0]?.c ?? 0n);
  }

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH target AS (
      SELECT id
      FROM "Job"
      WHERE "canonicalJobId" IS NOT NULL
        AND "createdAt" < now() - (${FRESH_BUFFER_DAYS} * interval '1 day')
        AND (
          ("expiresAt" IS NOT NULL AND "expiresAt" < now())
          OR "lastSeenAt" < now() - interval '14 days'
        )
      ORDER BY "lastSeenAt" ASC NULLS FIRST
      LIMIT ${limit}
    )
    DELETE FROM "Job" AS j
    USING target
    WHERE j.id = target.id
    RETURNING j.id
  `;
  return rows.length;
}

async function canonicalDeleteBatch(dryRun: boolean, limit: number): Promise<number> {
  if (dryRun) {
    const rows = await prisma.$queryRaw<Array<{ c: bigint }>>`
      WITH target AS (
        SELECT id
        FROM "Job"
        WHERE "canonicalJobId" IS NULL
          AND "createdAt" < now() - (${FRESH_BUFFER_DAYS} * interval '1 day')
          AND (
            ("expiresAt" IS NOT NULL AND "expiresAt" < now())
            OR "lastSeenAt" < now() - interval '30 days'
          )
          AND "salaryMin" IS NULL
          AND (
            "parsedDescription" IS NULL
            OR jsonb_typeof("parsedDescription") <> 'object'
            OR "parsedDescription" = '{}'::jsonb
          )
        ORDER BY COALESCE("expiresAt", "lastSeenAt", "createdAt") ASC
        LIMIT ${limit}
      )
      SELECT COUNT(*)::bigint AS c FROM target
    `;
    return Number(rows[0]?.c ?? 0n);
  }

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH target AS (
      SELECT id
      FROM "Job"
      WHERE "canonicalJobId" IS NULL
        AND "createdAt" < now() - (${FRESH_BUFFER_DAYS} * interval '1 day')
        AND (
          ("expiresAt" IS NOT NULL AND "expiresAt" < now())
          OR "lastSeenAt" < now() - interval '30 days'
        )
        AND "salaryMin" IS NULL
        AND (
          "parsedDescription" IS NULL
          OR jsonb_typeof("parsedDescription") <> 'object'
          OR "parsedDescription" = '{}'::jsonb
        )
      ORDER BY COALESCE("expiresAt", "lastSeenAt", "createdAt") ASC
      LIMIT ${limit}
    )
    DELETE FROM "Job" AS j
    USING target
    WHERE j.id = target.id
    RETURNING j.id
  `;
  return rows.length;
}

async function runPurge(): Promise<{
  dryRun: boolean;
  markedInactive: number;
  deletedDuplicates: number;
  deletedCanonicals: number;
  totalDeleted: number;
  dbBeforeBytes: number;
  dbAfterBytes: number;
}> {
  const dbBeforeBytes = await currentDbSizeBytes();
  let markedInactive = 0;
  let deletedDuplicates = 0;
  let deletedCanonicals = 0;
  let totalDeleted = 0;

  while (!DRY_RUN && totalDeleted < MAX_ROWS_PER_RUN) {
    const marked = await markExpiredInactiveBatch(Math.min(BATCH_SIZE, MAX_ROWS_PER_RUN - totalDeleted));
    markedInactive += marked;
    if (marked === 0) break;
  }

  while (totalDeleted < MAX_ROWS_PER_RUN) {
    const remaining = MAX_ROWS_PER_RUN - totalDeleted;
    if (remaining <= 0) break;
    const dupDeleted = await duplicateDeleteBatch(DRY_RUN, Math.min(BATCH_SIZE, remaining));
    deletedDuplicates += dupDeleted;
    totalDeleted += dupDeleted;
    if (dupDeleted === 0 || totalDeleted >= MAX_ROWS_PER_RUN) break;
  }

  while (totalDeleted < MAX_ROWS_PER_RUN) {
    const remaining = MAX_ROWS_PER_RUN - totalDeleted;
    if (remaining <= 0) break;
    const canonicalDeleted = await canonicalDeleteBatch(DRY_RUN, Math.min(BATCH_SIZE, remaining));
    deletedCanonicals += canonicalDeleted;
    totalDeleted += canonicalDeleted;
    if (canonicalDeleted === 0 || totalDeleted >= MAX_ROWS_PER_RUN) break;
  }

  const dbAfterBytes = await currentDbSizeBytes();
  return {
    dryRun: DRY_RUN,
    markedInactive,
    deletedDuplicates,
    deletedCanonicals,
    totalDeleted,
    dbBeforeBytes,
    dbAfterBytes,
  };
}

async function main(): Promise<void> {
  loadRootEnv();
  assertWorkerProcessEnv();

  logger.info(
    { event: "job_purge_worker_start", dryRun: DRY_RUN, batchSize: BATCH_SIZE, maxRows: MAX_ROWS_PER_RUN },
    "job_purge_worker_start",
  );

  const worker = new Worker(
    JOB_PURGE_QUEUE_NAME,
    async (job) => {
      if (job.name !== JOB_PURGE_TICK) return;
      const out = await runPurge();
      const capacityPctBefore = out.dbBeforeBytes > 0 ? (out.dbBeforeBytes / (500 * 1024 * 1024)) * 100 : 0;
      const capacityPctAfter = out.dbAfterBytes > 0 ? (out.dbAfterBytes / (500 * 1024 * 1024)) * 100 : 0;
      logger.info(
        {
          event: "job_purge_run",
          dryRun: out.dryRun,
          markedInactive: out.markedInactive,
          deletedDuplicates: out.deletedDuplicates,
          deletedCanonicals: out.deletedCanonicals,
          totalDeleted: out.totalDeleted,
          dbBeforeBytes: out.dbBeforeBytes,
          dbAfterBytes: out.dbAfterBytes,
          dbCapacityPctBefore: Number(capacityPctBefore.toFixed(2)),
          dbCapacityPctAfter: Number(capacityPctAfter.toFixed(2)),
          dbOver80Before: capacityPctBefore >= 80,
          dbOver80After: capacityPctAfter >= 80,
        },
        "job_purge_run",
      );
      return out;
    },
    { connection: getRedisConnection(), concurrency: 1 },
  );

  registerWorkerShutdown({
    worker,
    closeQueues: [closeJobPurgeQueue],
    prismaDisconnect: () => prisma.$disconnect(),
  });
}

void main().catch((err) => {
  logger.error({ event: "job_purge_worker_boot_failed", err }, "job_purge_worker_boot_failed");
  process.exitCode = 1;
});
