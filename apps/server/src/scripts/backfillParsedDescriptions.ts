/**
 * Backfill or re-parse `Job.parsedDescription` for canonical rows with a non-null `description`.
 *
 * Run:
 *   npx tsx src/scripts/backfillParsedDescriptions.ts
 *   npx tsx src/scripts/backfillParsedDescriptions.ts --force
 *   npx tsx src/scripts/backfillParsedDescriptions.ts --force --limit 100
 *   npx tsx src/scripts/backfillParsedDescriptions.ts --force --offset 5000
 */
import { Prisma } from "@prisma/client";
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { createJobRepository } from "../modules/job/job.repository.js";
import { logger } from "../utils/logger.js";
import { enrichCanonicalJobParsedDescription } from "../modules/ai/jobDescriptionEnrichment.js";
import type { ParsedJobDescriptionAI } from "../modules/ai/ai.types.js";

const FETCH_BATCH = 50;
/** Log every N jobs processed (updated / skipped / failed). */
const PROGRESS_EVERY = 50;

const BUCKETS: (keyof ParsedJobDescriptionAI)[] = [
  "position",
  "responsibility",
  "requirement",
  "experience",
  "benefit",
  "contact",
  "other",
];

function cliArgs(): string[] {
  const a = process.argv.slice(2);
  if (a[0] && !a[0].startsWith("-")) return a.slice(1);
  return a;
}

function parseArgs(argv: string[]): {
  force: boolean;
  limit: number | null;
  offset: number;
} {
  let force = false;
  let limit: number | null = null;
  let offset = 0;
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--force") {
      force = true;
      continue;
    }
    if (x === "--limit") {
      const raw = argv[++i];
      const n = raw === undefined ? NaN : Number(raw);
      if (!Number.isFinite(n) || n < 1) {
        throw new Error(`Invalid --limit (expected positive integer, got ${raw ?? "(missing)"})`);
      }
      limit = Math.floor(n);
      continue;
    }
    if (x === "--offset") {
      const raw = argv[++i];
      const n = raw === undefined ? NaN : Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(`Invalid --offset (expected non-negative integer, got ${raw ?? "(missing)"})`);
      }
      offset = Math.floor(n);
      continue;
    }
    if (x.startsWith("-")) {
      throw new Error(`Unknown flag: ${x}`);
    }
  }
  return { force, limit, offset };
}

function formatBucketCounts(pd: unknown): string {
  if (!pd || typeof pd !== "object") return "(no-parse)";
  const o = pd as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of BUCKETS) {
    const arr = o[k];
    const n = Array.isArray(arr) ? arr.length : 0;
    if (n > 0) parts.push(`${k}:${n}`);
  }
  return parts.length ? parts.join(" ") : "(empty)";
}

async function main(): Promise<void> {
  const started = Date.now();
  loadRootEnv();
  const { force, limit, offset } = parseArgs(cliArgs());
  const jobRepository = createJobRepository(prisma);

  const baseWhere: Prisma.JobWhereInput = {
    canonicalJobId: null,
    description: { not: null },
    ...(force ? {} : { parsedDescription: { equals: Prisma.DbNull } }),
  };

  const totalMatched = await prisma.job.count({ where: baseWhere });
  console.log(
    JSON.stringify(
      {
        totalMatched,
        force,
        limit: limit ?? null,
        offset,
        mode: force
          ? "re-parse all canonical jobs with description"
          : "only jobs with null parsedDescription",
      },
      null,
      2,
    ),
  );

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let lastId = "";
  let firstPage = true;
  let processed = 0;

  for (;;) {
    if (limit !== null && updated >= limit) break;

    const rows = await prisma.job.findMany({
      where: {
        ...baseWhere,
        ...(lastId ? { id: { gt: lastId } } : {}),
      },
      orderBy: { id: "asc" },
      select: { id: true },
      take: FETCH_BATCH,
      skip: firstPage && offset > 0 ? offset : 0,
    });
    firstPage = false;

    if (rows.length === 0) break;

    for (const row of rows) {
      if (limit !== null && updated >= limit) break;

      lastId = row.id;
      processed += 1;

      const full = await prisma.job.findUnique({
        where: { id: row.id },
        select: { description: true, parsedDescription: true },
      });
      if (!full?.description?.trim()) {
        skipped += 1;
        if (processed % PROGRESS_EVERY === 0) {
          console.log(
            `[${processed}/${totalMatched}] ${row.id} -> skipped (no description)`,
          );
        }
        continue;
      }
      if (!force && full.parsedDescription != null) {
        skipped += 1;
        if (processed % PROGRESS_EVERY === 0) {
          console.log(`[${processed}/${totalMatched}] ${row.id} -> skipped (has parse)`);
        }
        continue;
      }

      try {
        await enrichCanonicalJobParsedDescription(prisma, jobRepository, row.id, true);
        updated += 1;
        const after = await prisma.job.findUnique({
          where: { id: row.id },
          select: { parsedDescription: true },
        });
        const counts = formatBucketCounts(after?.parsedDescription);
        if (
          processed % PROGRESS_EVERY === 0 ||
          (limit !== null && updated === limit)
        ) {
          console.log(`[${processed}/${totalMatched}] ${row.id} -> ${counts}`);
        }
      } catch (err) {
        failed += 1;
        if (processed % PROGRESS_EVERY === 0) {
          console.log(`[${processed}/${totalMatched}] ${row.id} -> failed`);
        }
        logger.error(
          { event: "backfill_parsed_description_row_failed", jobId: row.id, err },
          "backfill_parsed_description_row_failed",
        );
      }
    }

    if (rows.length < FETCH_BATCH) break;
  }

  const durationMs = Date.now() - started;
  logger.info(
    {
      event: "backfill_parsed_descriptions_done",
      updated,
      skipped,
      failed,
      total: totalMatched,
      durationMs,
      force,
      limit,
      offset,
    },
    "backfill_parsed_descriptions_done",
  );
  console.log(
    JSON.stringify(
      { updated, skipped, failed, total: totalMatched, durationMs },
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
  .finally(() => prisma.$disconnect());
