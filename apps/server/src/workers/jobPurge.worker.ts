import { Worker } from "bullmq";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { logger } from "../utils/logger.js";
import { assertWorkerProcessEnv } from "../infrastructure/env/validateWorkerEnv.js";
import { registerWorkerShutdown } from "../utils/workerShutdown.js";
import { startWorkerHeartbeat } from "../services/workerHeartbeat.service.js";
import {
  closeJobPurgeQueue,
  JOB_PURGE_QUEUE_NAME,
  JOB_PURGE_TICK,
} from "../queues/jobPurge.queue.js";
import { getIoredis, getRedisConnection } from "../queues/job.queue.js";
import { invalidateJobDetailSeoCaches } from "../services/jobSeoCacheInvalidation.service.js";
import {
  resolveJobRedirectTargetPath,
  type JobRedirectSource,
} from "../services/jobRedirect.service.js";

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

/** OG-1.3: persist redirect targets before hard-delete so /job/{id} can 301. */
async function writeJobRedirectsForIds(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const jobs = await prisma.job.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      role: true,
      category: true,
      locationCountry: true,
      isRemote: true,
      company: { select: { slug: true } },
    },
  });
  if (jobs.length === 0) return 0;

  const now = new Date();
  const rows = jobs.map((job) => {
    const source: JobRedirectSource = {
      id: job.id,
      role: job.role,
      category: job.category,
      locationCountry: job.locationCountry,
      isRemote: job.isRemote,
      company: job.company,
    };
    return {
      id: randomUUID(),
      jobId: job.id,
      targetPath: resolveJobRedirectTargetPath(source),
      companySlug: job.company?.slug ?? null,
      createdAt: now,
    };
  });

  // Prisma createMany skipDuplicates needs unique jobId; upsert in chunks for conflict updates.
  let written = 0;
  const chunkSize = 200;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map((row) =>
        prisma.jobRedirect.upsert({
          where: { jobId: row.jobId },
          create: row,
          update: {
            targetPath: row.targetPath,
            companySlug: row.companySlug,
          },
        }),
      ),
    );
    written += chunk.length;
  }
  return written;
}

async function markExpiredInactiveBatch(limit: number): Promise<string[]> {
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
  return rows.map((row) => row.id);
}

async function duplicateDeleteBatch(dryRun: boolean, limit: number): Promise<string[]> {
  if (dryRun) {
    await prisma.$queryRaw<Array<{ c: bigint }>>`
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
    return [];
  }

  const targets = await prisma.$queryRaw<Array<{ id: string }>>`
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
  `;
  const ids = targets.map((r) => r.id);
  if (ids.length === 0) return [];
  await writeJobRedirectsForIds(ids);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    DELETE FROM "Job" AS j
    WHERE j.id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}`))})
    RETURNING j.id
  `;
  return rows.map((row) => row.id);
}

async function canonicalDeleteBatch(dryRun: boolean, limit: number): Promise<string[]> {
  if (dryRun) {
    await prisma.$queryRaw<Array<{ c: bigint }>>`
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
    return [];
  }

  const targets = await prisma.$queryRaw<Array<{ id: string }>>`
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
  `;
  const ids = targets.map((r) => r.id);
  if (ids.length === 0) return [];
  await writeJobRedirectsForIds(ids);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    DELETE FROM "Job" AS j
    WHERE j.id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}`))})
    RETURNING j.id
  `;
  return rows.map((row) => row.id);
}

async function runPurge(): Promise<{
  dryRun: boolean;
  markedInactive: number;
  deletedDuplicates: number;
  deletedCanonicals: number;
  totalDeleted: number;
  invalidatedJobIds: number;
  dbBeforeBytes: number;
  dbAfterBytes: number;
}> {
  const dbBeforeBytes = await currentDbSizeBytes();
  let markedInactive = 0;
  let deletedDuplicates = 0;
  let deletedCanonicals = 0;
  let totalDeleted = 0;
  const invalidatedIds = new Set<string>();

  while (!DRY_RUN && totalDeleted < MAX_ROWS_PER_RUN) {
    const markedIds = await markExpiredInactiveBatch(
      Math.min(BATCH_SIZE, MAX_ROWS_PER_RUN - totalDeleted),
    );
    markedInactive += markedIds.length;
    for (const id of markedIds) invalidatedIds.add(id);
    if (markedIds.length === 0) break;
  }

  while (totalDeleted < MAX_ROWS_PER_RUN) {
    const remaining = MAX_ROWS_PER_RUN - totalDeleted;
    if (remaining <= 0) break;
    const dupDeleted = await duplicateDeleteBatch(DRY_RUN, Math.min(BATCH_SIZE, remaining));
    deletedDuplicates += dupDeleted.length;
    totalDeleted += dupDeleted.length;
    for (const id of dupDeleted) invalidatedIds.add(id);
    if (dupDeleted.length === 0 || totalDeleted >= MAX_ROWS_PER_RUN) break;
  }

  while (totalDeleted < MAX_ROWS_PER_RUN) {
    const remaining = MAX_ROWS_PER_RUN - totalDeleted;
    if (remaining <= 0) break;
    const canonicalDeleted = await canonicalDeleteBatch(DRY_RUN, Math.min(BATCH_SIZE, remaining));
    deletedCanonicals += canonicalDeleted.length;
    totalDeleted += canonicalDeleted.length;
    for (const id of canonicalDeleted) invalidatedIds.add(id);
    if (canonicalDeleted.length === 0 || totalDeleted >= MAX_ROWS_PER_RUN) break;
  }

  if (!DRY_RUN && invalidatedIds.size > 0) {
    await invalidateJobDetailSeoCaches(getIoredis(), [...invalidatedIds]);
  }

  const dbAfterBytes = await currentDbSizeBytes();
  return {
    dryRun: DRY_RUN,
    markedInactive,
    deletedDuplicates,
    deletedCanonicals,
    totalDeleted,
    invalidatedJobIds: invalidatedIds.size,
    dbBeforeBytes,
    dbAfterBytes,
  };
}

async function main(): Promise<void> {
  loadRootEnv();
  assertWorkerProcessEnv();
  startWorkerHeartbeat("job-purge");

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
          invalidatedJobIds: out.invalidatedJobIds,
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
