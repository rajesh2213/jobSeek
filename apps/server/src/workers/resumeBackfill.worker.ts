import { Worker } from "bullmq";
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { logger } from "../utils/logger.js";
import { assertWorkerProcessEnv } from "../infrastructure/env/validateWorkerEnv.js";
import { registerWorkerShutdown } from "../utils/workerShutdown.js";
import {
  closeResumeBackfillQueue,
  RESUME_BACKFILL_QUEUE_NAME,
  RESUME_BACKFILL_TICK_JOB,
} from "../queues/resumeBackfill.queue.js";
import { getRedisConnection } from "../queues/job.queue.js";
import { getResumeObjectStore } from "../infrastructure/storage/resumeObjectStore.js";
import {
  buildResumeObjectKey,
  bufferToStream,
  detectResumeExtension,
  sha256Hex,
} from "../modules/account/resumeStorage.js";
import { mimeTypeFromResumeFileName } from "../utils/resumeParser.js";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 300;

function batchSize(): number {
  const parsed = Number.parseInt(process.env.RESUME_BACKFILL_BATCH_SIZE ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_BATCH_SIZE;
  return Math.min(parsed, MAX_BATCH_SIZE);
}

async function runBackfillOnce(): Promise<{
  scanned: number;
  migrated: number;
  skipped: number;
  failed: number;
}> {
  const take = batchSize();
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      resumeFileData: Uint8Array;
      resumeFileName: string | null;
      resumeFileKey: string | null;
    }>
  >`
    SELECT id, "resumeFileData", "resumeFileName", "resumeFileKey"
    FROM "User"
    WHERE "resumeFileData" IS NOT NULL
      AND octet_length("resumeFileData") > 0
    ORDER BY "updatedAt" ASC
    LIMIT ${take}
  `;
  if (rows.length === 0) {
    return { scanned: 0, migrated: 0, skipped: 0, failed: 0 };
  }

  const store = getResumeObjectStore();
  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const fileName = row.resumeFileName?.trim() || "resume.pdf";
    const mime = mimeTypeFromResumeFileName(fileName);
    const normalizedMime = mime === "application/octet-stream" ? "application/pdf" : mime;
    const buffer = Buffer.from(row.resumeFileData);
    const hashHex = sha256Hex(buffer);
    const ext = detectResumeExtension({ fileName, mimeType: normalizedMime });
    const key =
      row.resumeFileKey?.trim() ||
      buildResumeObjectKey({ userId: row.id, hashHex, extension: ext });
    try {
      const exists = await store.hasObject(key);
      if (!exists) {
        await store.putObject({
          key,
          body: bufferToStream(buffer),
          contentType: normalizedMime,
          contentLength: buffer.length,
        });
      }

      await prisma.$executeRaw`
        UPDATE "User"
        SET "resumeFileKey" = ${key},
            "resumeFileSize" = ${buffer.length},
            "resumeFileData" = NULL
        WHERE id = ${row.id}
      `;
      migrated += 1;
    } catch (err) {
      failed += 1;
      logger.error(
        { event: "resume_backfill_row_failed", userId: row.id, key, err },
        "resume_backfill_row_failed",
      );
      continue;
    }
    if (row.resumeFileKey === key) {
      skipped += 1;
    }
  }

  return { scanned: rows.length, migrated, skipped, failed };
}

async function main(): Promise<void> {
  loadRootEnv();
  assertWorkerProcessEnv();
  logger.info({ event: "resume_backfill_worker_start" }, "resume_backfill_worker_start");

  const worker = new Worker(
    RESUME_BACKFILL_QUEUE_NAME,
    async (job) => {
      if (job.name !== RESUME_BACKFILL_TICK_JOB) return;
      const out = await runBackfillOnce();
      logger.info(
        {
          event: "resume_backfill_run",
          scanned: out.scanned,
          migrated: out.migrated,
          skipped: out.skipped,
          failed: out.failed,
        },
        "resume_backfill_run",
      );
      return out;
    },
    { connection: getRedisConnection(), concurrency: 1 },
  );

  registerWorkerShutdown({
    worker,
    closeQueues: [closeResumeBackfillQueue],
    prismaDisconnect: () => prisma.$disconnect(),
  });
}

void main().catch((err) => {
  logger.error({ event: "resume_backfill_worker_boot_failed", err }, "resume_backfill_worker_boot_failed");
  process.exitCode = 1;
});
