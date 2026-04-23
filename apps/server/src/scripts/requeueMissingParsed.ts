/**
 * One-off: enqueue PROCESS_JOB for jobs that are `ready` but never received parsedDescription.
 * Does not change DB status — only adds Bull jobs (batch ≤ 50).
 * Uses a high BullMQ `priority` so repair jobs are preferred.
 *
 *   npm run requeue-missing-parsed -w @jobseek/server
 *   npx tsx src/scripts/requeueMissingParsed.ts
 */
import { Prisma } from "@prisma/client";
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { getJobQueue, closeJobQueue, closeRedisConnection } from "../queues/job.queue.js";
import { PROCESS_JOB, type NormalizedJob } from "../modules/crawler/crawler.types.js";
import { isSupportedAtsType, type AtsType } from "../modules/ats/ats.interface.js";
import { logger } from "../utils/logger.js";

const LIMIT = Math.max(
  1,
  Math.min(500, Number(process.env.REQUEUE_MISSING_PARSED_LIMIT ?? "50")) || 50,
);

const REQUEUE_PRIORITY = 1_000_000;

function buildLocation(row: {
  locationCity: string | null;
  locationState: string | null;
  locationCountry: string;
}): string | undefined {
  const parts: string[] = [];
  if (row.locationCity) parts.push(row.locationCity);
  if (row.locationState) parts.push(row.locationState);
  if (row.locationCountry && row.locationCountry !== "UNKNOWN") {
    parts.push(row.locationCountry);
  }
  if (parts.length === 0) return undefined;
  return parts.join(", ");
}

function toPayload(row: {
  id: string;
  title: string;
  companyId: string;
  source: string;
  sourceUrl: string;
  description: string | null;
  isRemote: boolean;
  applyUrl: string | null;
  postedAt: Date | null;
  atsJobId: string | null;
  locationCity: string | null;
  locationState: string | null;
  locationCountry: string;
  company: { name: string };
}): NormalizedJob | null {
  const sourceStr = String(row.source);
  if (!isSupportedAtsType(sourceStr)) {
    logger.warn(
      { event: "requeue_skip_unsupported_source", jobId: row.id, source: row.source },
      "skip job: unsupported source",
    );
    return null;
  }
  return {
    jobId: row.id,
    title: row.title,
    sourceUrl: row.sourceUrl,
    companyId: row.companyId,
    source: sourceStr as AtsType,
    isRemote: row.isRemote,
    description: row.description ?? undefined,
    location: buildLocation(row),
    applyUrl: row.applyUrl ?? undefined,
    postedAt: row.postedAt ?? undefined,
    atsJobId: row.atsJobId ?? undefined,
    companyName: row.company.name,
  };
}

async function main(): Promise<void> {
  loadRootEnv();
  const rows = await prisma.job.findMany({
    where: {
      status: "ready",
      OR: [
        { parsedDescription: { equals: Prisma.DbNull } },
        { parsedDescription: { equals: Prisma.JsonNull } },
      ],
    },
    take: LIMIT,
    orderBy: { updatedAt: "asc" },
    include: { company: { select: { name: true } } },
  });
  if (rows.length === 0) {
    logger.info({ event: "requeue_missing_parsed_empty" }, "requeueMissingParsed: no matching jobs");
    return;
  }
  const queue = getJobQueue();
  let enqueued = 0;
  for (const row of rows) {
    const payload = toPayload({
      id: row.id,
      title: row.title,
      companyId: row.companyId,
      source: row.source,
      sourceUrl: row.sourceUrl,
      description: row.description,
      isRemote: row.isRemote,
      applyUrl: row.applyUrl,
      postedAt: row.postedAt,
      atsJobId: row.atsJobId,
      locationCity: row.locationCity,
      locationState: row.locationState,
      locationCountry: row.locationCountry,
      company: row.company,
    });
    if (!payload) continue;
    await queue.add(PROCESS_JOB, payload, { priority: REQUEUE_PRIORITY });
    enqueued += 1;
  }
  logger.info(
    {
      event: "requeue_missing_parsed_done",
      fetched: rows.length,
      enqueued,
      jobQueue: "job-processing",
      name: PROCESS_JOB,
      priority: REQUEUE_PRIORITY,
    },
    "requeueMissingParsed complete",
  );
  await closeJobQueue();
  await closeRedisConnection();
  await prisma.$disconnect();
}

main().catch((err) => {
  logger.error({ event: "requeue_missing_parsed_failed", err }, "requeueMissingParsed failed");
  process.exit(1);
});
