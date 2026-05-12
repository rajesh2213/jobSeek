/**
 * Cleanse Job rows where `postedAt` is a crawl-timestamp proxy left behind by
 * the deleted `createdAtProxy` backfill branch. Read-safe by default; mutations
 * only with `--commit`.
 *
 * Heuristic for "contaminated":
 *   ABS(postedAt - createdAt) < THRESHOLD_SECONDS AND source IN (--sources list)
 *
 * The default source allowlist (`wellfound`, `careers_page`) is the
 * highest-confidence intersection between the Phase 2 audit and the adapter
 * code review: those ingestion paths never set `postedAt` directly, so any
 * non-null `postedAt` near `createdAt` was injected by the proxy backfill.
 *
 * What this script does on a contaminated row:
 *   1. SET postedAt = NULL
 *   2. SET effectivePostedAt = createdAt
 *      (keeps the stored-generated `listingFreshnessAt = COALESCE(effectivePostedAt, createdAt)`
 *       unchanged so pagination ordering does NOT shift)
 *   3. Recompute the canonical aggregation for affected canonical ids
 *      (so duplicate-side cleansing self-heals canonical-side `postedAt`).
 *
 * Usage:
 *   cd apps/server
 *   # dry-run, default sources, default threshold:
 *   DATABASE_URL=... npx tsx scripts/freshness/cleanseContaminatedPostedAt.ts
 *   # dry-run, custom source list:
 *   DATABASE_URL=... npx tsx scripts/freshness/cleanseContaminatedPostedAt.ts --sources=wellfound
 *   # commit mode (writes happen):
 *   DATABASE_URL=... npx tsx scripts/freshness/cleanseContaminatedPostedAt.ts --commit
 *   # resume from a previous run's last cursor:
 *   DATABASE_URL=... npx tsx scripts/freshness/cleanseContaminatedPostedAt.ts --commit --cursor=<lastId>
 *
 * Operational notes:
 *   - Batched (default 200 rows). Resumable via --cursor.
 *   - Sleeps between batches (default 100ms) so the script never starves
 *     production transactions.
 *   - Each batch is a short transaction with the batchTransactionOptionsLong
 *     budget (5s); abort and retry on conflict.
 *   - Memory usage is bounded by BATCH_SIZE; safe on multi-GB tables.
 *
 *   This script does NOT touch sources outside the allowlist. To extend it,
 *   pass --sources=<csv>. Greenhouse is intentionally excluded — its
 *   `updated_at`-as-postedAt issue is a parser fix, not a cleansing target.
 */
import { Prisma } from "@prisma/client";
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";
import { batchTransactionOptionsLong } from "../../src/infrastructure/db/prismaTransactionOptions.js";
import { recomputeCanonical } from "../../src/services/jobCanonical.service.js";
import { createJobRepository } from "../../src/modules/job/job.repository.js";

loadRootEnv();

const DEFAULT_SOURCES = ["wellfound", "careers_page"];
const DEFAULT_THRESHOLD_SECONDS = 60;
const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_SLEEP_MS = 100;

interface Args {
  commit: boolean;
  cursor: string | null;
  sources: string[];
  thresholdSeconds: number;
  batchSize: number;
  sleepMs: number;
  maxBatches: number;
}

function parseArgs(argv: string[]): Args {
  const findValue = (prefix: string): string | undefined => {
    const raw = argv.find((a) => a.startsWith(prefix));
    return raw ? raw.slice(prefix.length) : undefined;
  };
  return {
    commit: argv.includes("--commit"),
    cursor: findValue("--cursor=") ?? null,
    sources: (findValue("--sources=") ?? DEFAULT_SOURCES.join(","))
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    thresholdSeconds: Math.max(
      0,
      parseInt(findValue("--threshold-seconds=") ?? String(DEFAULT_THRESHOLD_SECONDS), 10) ||
        DEFAULT_THRESHOLD_SECONDS,
    ),
    batchSize: Math.max(
      1,
      Math.min(2000, parseInt(findValue("--batch-size=") ?? String(DEFAULT_BATCH_SIZE), 10) || DEFAULT_BATCH_SIZE),
    ),
    sleepMs: Math.max(0, parseInt(findValue("--sleep-ms=") ?? String(DEFAULT_SLEEP_MS), 10) || DEFAULT_SLEEP_MS),
    maxBatches: Math.max(
      0,
      parseInt(findValue("--max-batches=") ?? "0", 10) || 0,
    ),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

interface ContaminatedRow {
  id: string;
  canonicalJobId: string | null;
  createdAt: Date;
}

async function fetchBatch(
  cursor: string | null,
  sources: string[],
  thresholdSeconds: number,
  batchSize: number,
): Promise<ContaminatedRow[]> {
  /** Parameterized raw SQL — `sources` is bound as a postgres text[] to avoid SQL injection. */
  const sourcesParam = Prisma.sql`${Prisma.join(sources.map((s) => Prisma.sql`${s}`))}`;
  const cursorClause = cursor
    ? Prisma.sql`AND j.id > ${cursor}`
    : Prisma.sql``;
  const rows = await prisma.$queryRaw<Array<{ id: string; canonicalJobId: string | null; createdAt: Date }>>(
    Prisma.sql`
      SELECT j.id, j."canonicalJobId" AS "canonicalJobId", j."createdAt"
      FROM "Job" j
      WHERE j.source IN (${sourcesParam})
        AND j."postedAt" IS NOT NULL
        AND ABS(EXTRACT(EPOCH FROM (j."postedAt" - j."createdAt"))) < ${thresholdSeconds}
        ${cursorClause}
      ORDER BY j.id ASC
      LIMIT ${batchSize}
    `,
  );
  return rows;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL is required.");
    process.exitCode = 1;
    return;
  }
  if (args.sources.length === 0) {
    console.error("--sources= must include at least one source name.");
    process.exitCode = 1;
    return;
  }

  console.log("=== freshness:cleanse ===");
  console.log(
    JSON.stringify(
      {
        commit: args.commit,
        cursor: args.cursor,
        sources: args.sources,
        thresholdSeconds: args.thresholdSeconds,
        batchSize: args.batchSize,
        sleepMs: args.sleepMs,
        maxBatches: args.maxBatches || "unlimited",
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  let cursor = args.cursor;
  let processed = 0;
  let mutated = 0;
  let canonicalIdsRecomputed = 0;
  let batchIndex = 0;
  const recomputeQueue = new Set<string>();

  for (;;) {
    if (args.maxBatches && batchIndex >= args.maxBatches) {
      console.log(`[stop] reached --max-batches=${args.maxBatches}`);
      break;
    }
    const batch = await fetchBatch(cursor, args.sources, args.thresholdSeconds, args.batchSize);
    if (batch.length === 0) {
      console.log("[stop] no more contaminated rows");
      break;
    }
    const ids = batch.map((r) => r.id);
    const lastId = ids[ids.length - 1]!;
    processed += batch.length;
    batchIndex += 1;

    if (args.commit) {
      await prisma.$transaction(
        async (tx) => {
          /**
           * SET postedAt = NULL, effectivePostedAt = createdAt.
           * This keeps `listingFreshnessAt = COALESCE(effectivePostedAt, createdAt)` unchanged,
           * so the new ORDER BY (Phase 5) re-buckets these rows from POSTED to DISCOVERED
           * without altering their position within the DISCOVERED bucket.
           */
          await tx.$executeRaw(Prisma.sql`
            UPDATE "Job"
            SET "postedAt" = NULL,
                "effectivePostedAt" = "createdAt"
            WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}`))})
          `);
        },
        { ...batchTransactionOptionsLong },
      );
      mutated += batch.length;

      /** Collect canonical ids for post-batch recompute. Duplicate rows roll up to their canonical. */
      for (const r of batch) {
        if (r.canonicalJobId) recomputeQueue.add(r.canonicalJobId);
        else recomputeQueue.add(r.id);
      }
    }

    cursor = lastId;
    console.log(
      `[batch ${batchIndex}] size=${batch.length} cursor=${lastId} processed=${processed} mutated=${mutated} dryRun=${!args.commit}`,
    );

    if (args.sleepMs > 0 && batch.length === args.batchSize) {
      await sleep(args.sleepMs);
    }
  }

  /** Recompute canonical aggregations OUTSIDE the cleansing transactions so we don't hold long locks. */
  if (args.commit && recomputeQueue.size > 0) {
    console.log(`[recompute] starting for ${recomputeQueue.size} canonical id(s)`);
    const repo = createJobRepository(prisma);
    for (const id of recomputeQueue) {
      try {
        await recomputeCanonical(repo, id);
        canonicalIdsRecomputed += 1;
      } catch (err) {
        console.warn(`[recompute] failed for ${id}:`, err instanceof Error ? err.message : err);
      }
      if (args.sleepMs > 0) await sleep(args.sleepMs);
    }
  }

  console.log("\n=== Summary ===");
  console.log(
    JSON.stringify(
      {
        commit: args.commit,
        processed,
        mutated,
        canonicalIdsRecomputed,
        lastCursor: cursor,
        finishedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  if (!args.commit) {
    console.log("\nDry-run only — pass --commit to write changes.");
    console.log(`To resume after a partial commit, use --cursor=${cursor ?? "<lastId>"}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
