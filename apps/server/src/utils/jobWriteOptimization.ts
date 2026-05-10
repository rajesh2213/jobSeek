import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

/**
 * Deploy A: guarded hash-cache UPDATE (single round trip, RETURNING).
 * Opt-in only: set `JOB_HASH_CACHE_CONDITIONAL_UPDATE=1`. Unset or any other value uses
 * legacy unconditional Prisma `updateMany` on hash-cache hits (safer staged rollout).
 */
export function jobHashCacheConditionalUpdateEnabled(): boolean {
  return process.env.JOB_HASH_CACHE_CONDITIONAL_UPDATE === "1";
}

/**
 * Deploy B: skip `updateParsedDescription` when persisted JSON/skills unchanged.
 * Opt-in: set `JOB_PARSED_NOOP_SKIP=1` after Deploy A soak.
 */
export function jobParsedNoopSkipEnabled(): boolean {
  return process.env.JOB_PARSED_NOOP_SKIP === "1";
}

/**
 * Deploy C: skip redundant `updateLastSeenById` when batch touch already applied.
 * Requires `JOB_DEDUP_TOUCH_SKIP=1` and callers passing `batchTouchAtMs`.
 */
export function jobDedupTouchSkipEnabled(): boolean {
  return process.env.JOB_DEDUP_TOUCH_SKIP === "1";
}

export function jobDedupTouchSlackMs(): number {
  const n = Number(process.env.JOB_DEDUP_TOUCH_SLACK_MS ?? "5000");
  return Math.max(1000, Math.min(30_000, Number.isFinite(n) ? n : 5000));
}

/**
 * Freshness window for hash-cache skip: if `lastProcessedAt` is newer than this threshold,
 * and `contentHash` matches, skip UPDATE. Initial rollout: clamp 5–15 minutes (plan).
 */
export function jobProcessingFreshnessStaleBefore(nowMs = Date.now()): Date {
  const raw = Number(process.env.JOB_PROCESSING_FRESHNESS_MINUTES ?? "10") || 10;
  const minutes = Math.max(5, Math.min(15, raw));
  return new Date(nowMs - minutes * 60_000);
}

export type ConditionalHashCacheUpdateParams = {
  sourceUrl: string;
  contentHash: string;
  processedAt: Date;
};

/**
 * Single atomic UPDATE … RETURNING. No row version churn when WHERE does not match.
 * Aligns with Prisma `@updatedAt` by setting `updatedAt = NOW()` only when a row updates.
 */
export async function conditionalUpdateJobHashCacheHit(
  prisma: PrismaClient,
  params: ConditionalHashCacheUpdateParams,
): Promise<boolean> {
  const staleBefore = jobProcessingFreshnessStaleBefore(params.processedAt.getTime());
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "Job"
    SET
      "lastProcessedAt" = ${params.processedAt},
      "contentHash" = ${params.contentHash},
      "updatedAt" = NOW()
    WHERE "sourceUrl" = ${params.sourceUrl}
      AND (
        "contentHash" IS DISTINCT FROM ${params.contentHash}
        OR "lastProcessedAt" IS NULL
        OR "lastProcessedAt" < ${staleBefore}
      )
    RETURNING id
  `;
  return rows.length > 0;
}

/** Deploy D: chunked ATS finalize. Opt-in: `ATS_FINALIZE_CHUNKED=1`. */
export function atsFinalizeChunkedEnabled(): boolean {
  return process.env.ATS_FINALIZE_CHUNKED === "1";
}

/** Max rows per UPDATE chunk on Nano; default 500 (plan). */
export function atsFinalizeChunkSize(): number {
  const n = Number(process.env.ATS_FINALIZE_CHUNK_SIZE ?? "500") || 500;
  return Math.max(50, Math.min(2000, Math.floor(n)));
}

export type FinalizeRow = { canonicalId: string; newContentHash: string };

/**
 * One bounded multi-row UPDATE per chunk using VALUES — avoids mega-unnest on Nano.
 */
export async function finalizeIngestChunked(
  prisma: PrismaClient,
  rows: FinalizeRow[],
  processedAt: Date,
): Promise<void> {
  if (rows.length === 0) return;
  const chunkSize = atsFinalizeChunkSize();
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const valueTuples = chunk.map(
      (r) => Prisma.sql`(${r.canonicalId}::uuid, ${r.newContentHash}::varchar(64))`,
    );
    const updated = await prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "Job" AS j
      SET
        "lastProcessedAt" = ${processedAt},
        "contentHash" = v.hash,
        "updatedAt" = NOW()
      FROM (VALUES ${Prisma.join(valueTuples)}) AS v(id, hash)
      WHERE j.id = v.id
      RETURNING j.id
    `;
    if (updated.length !== chunk.length) {
      throw new Error(
        `atsEndpoint.worker.finalize.chunk_missing_rows: expected ${chunk.length} got ${updated.length}`,
      );
    }
  }
}

export function shouldSkipRedundantLastSeenAfterBatchTouch(
  existingLastSeenAt: Date,
  batchTouchAtMs: number | undefined,
): boolean {
  if (!jobDedupTouchSkipEnabled() || batchTouchAtMs == null) return false;
  const slack = jobDedupTouchSlackMs();
  return existingLastSeenAt.getTime() >= batchTouchAtMs - slack;
}
