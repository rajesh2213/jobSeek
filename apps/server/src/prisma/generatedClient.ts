/**
 * Re-exports from the generated client under `node_modules/.prisma/client` so tooling
 * resolves the same types as `npx prisma generate` (some editors mis-resolve `@prisma/client`).
 */
import type { Prisma as PrismaTypes } from "../../../../node_modules/.prisma/client/index.js";
export {
  Prisma,
  PrismaClient,
  CompanyCrawlPriority,
} from "../../../../node_modules/.prisma/client/index.js";

/** Narrow `Company` update fields used by company score (stable across Prisma @prisma/client resolution). */
export type CompanyScoreUpdatePayload = Pick<
  PrismaTypes.CompanyUpdateInput,
  "score" | "priority" | "canonicalJobsLast7d"
>;

/**
 * After ingestion: required counters plus optional last success timestamp.
 * `lastCrawledAt` on Company = last **successful** ingest/crawl completion (worker),
 * not scheduler enqueue time (see `recordIngestionFinished` callers).
 */
export type IngestionFinishedUpdate = {
  lastAttemptAt: Date;
  ingestionAttempts: { increment: number };
  lastIngestionSuccessAt?: Date;
  lastCrawledAt?: Date;
};
