/**
 * List canonical jobs that need parsedDescription (SQL NULL or JSON null).
 *   npx tsx src/scripts/findJobsMissingParsed.ts
 */
import { Prisma } from "@prisma/client";
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { logger } from "../utils/logger.js";

const LIMIT = Math.max(
  1,
  Math.min(500, Number(process.env.FIND_JOBS_MISSING_PARSED_LIMIT ?? "50")) || 50,
);

async function main(): Promise<void> {
  loadRootEnv();
  const where = {
    status: "ready" as const,
    OR: [
      { parsedDescription: { equals: Prisma.DbNull } },
      { parsedDescription: { equals: Prisma.JsonNull } },
    ],
  };
  const count = await prisma.job.count({ where });
  const rows = await prisma.job.findMany({
    where,
    take: LIMIT,
    orderBy: { updatedAt: "asc" },
    select: { id: true, title: true, companyId: true },
  });
  logger.info(
    {
      event: "find_jobs_missing_parsed",
      countMatching: count,
      sampleSize: rows.length,
      sampleIds: rows.map((r) => r.id),
      sample: rows.slice(0, 5).map((r) => ({
        id: r.id,
        title: r.title,
        companyId: r.companyId,
      })),
    },
    "findJobsMissingParsed",
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  logger.error({ event: "find_jobs_missing_parsed_failed", err }, "findJobsMissingParsed failed");
  process.exit(1);
});
