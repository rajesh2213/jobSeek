/**
 * Recompute `Job.enriched` from existing `parsedDescription` (canonical rows only).
 * Run: npx tsx src/scripts/backfillJobEnrichment.ts
 */
import { Prisma } from "@prisma/client";
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { enrichJob } from "../modules/enrichment/enrichment.service.js";
import { logger } from "../utils/logger.js";

const BATCH = 100;

async function main(): Promise<void> {
  loadRootEnv();

  let updated = 0;
  let skipped = 0;
  let lastId = "";

  for (;;) {
    const rows = await prisma.job.findMany({
      where: {
        canonicalJobId: null,
        parsedDescription: { not: Prisma.DbNull },
        enriched: { equals: Prisma.DbNull },
        ...(lastId ? { id: { gt: lastId } } : {}),
      },
      orderBy: { id: "asc" },
      select: { id: true, parsedDescription: true },
      take: BATCH,
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      lastId = row.id;
      if (row.parsedDescription == null) {
        skipped += 1;
        continue;
      }
      const enriched = enrichJob(row.parsedDescription);
      await prisma.job.update({
        where: { id: row.id },
        data: { enriched: enriched as unknown as Prisma.InputJsonValue },
      });
      updated += 1;
    }

    if (rows.length < BATCH) break;
  }

  logger.info(
    { event: "backfill_job_enrichment_done", updated, skipped },
    "backfill_job_enrichment_done",
  );
  console.log(JSON.stringify({ updated, skipped }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
