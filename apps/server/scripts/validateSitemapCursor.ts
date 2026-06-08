/**
 * Validates cursor sitemap IDs vs OFFSET id-list parity (same discovery SQL).
 * Usage: npm run validate:sitemap-cursor -w @jobseek/server
 */
import { PrismaClient } from "@prisma/client";
import { loadRootEnv } from "../src/infrastructure/env/loadEnv.js";
import { createJobRepository } from "../src/modules/job/job.repository.js";

loadRootEnv();

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const repo = createJobRepository(prisma);

  const dbCount = await repo.countCanonicalFiltered();
  const sampleSize = Math.min(dbCount, 2000);
  console.log("DB discovery count:", dbCount);
  console.log("Comparing cursor vs OFFSET id-list for", sampleSize, "rows\n");

  const cursorIds: string[] = [];
  let cursor: string | null = null;
  for (;;) {
    const { rows, nextCursor } = await repo.findManyCanonicalForSitemap({
      limit: 500,
      cursor,
    });
    for (const r of rows) cursorIds.push(r.id);
    if (cursorIds.length >= sampleSize || !nextCursor) break;
    cursor = nextCursor;
  }
  const cursorSample = cursorIds.slice(0, sampleSize);

  const offsetIds: string[] = [];
  let offset = 0;
  while (offsetIds.length < sampleSize) {
    const batch = await prisma.$queryRaw<{ id: string }[]>`
      SELECT j.id FROM "Job" j
      WHERE j."canonicalJobId" IS NULL
        AND j."isActive" = true
        AND (j."expiresAt" IS NULL OR j."expiresAt" > NOW())
        AND j.role NOT IN (
          'job-role','careers','jobs','job','all','benefits',
          'open-roles','career-search','searchcareer','career-areas'
        )
        AND (j."status" = 'ready' OR j."status" IS NULL)
        AND j.description IS NOT NULL
        AND BTRIM(j.description) <> ''
      ORDER BY j."postedAt" DESC NULLS LAST,
               j."listingFreshnessAt" DESC,
               j."createdAt" DESC,
               j.id ASC
      LIMIT 500 OFFSET ${offset}
    `;
    if (batch.length === 0) break;
    offsetIds.push(...batch.map((r) => r.id));
    offset += batch.length;
  }
  const offsetSample = offsetIds.slice(0, sampleSize);

  let mismatches = 0;
  for (let i = 0; i < sampleSize; i++) {
    if (cursorSample[i] !== offsetSample[i]) mismatches++;
  }

  const dupes = cursorSample.length - new Set(cursorSample).size;
  console.log("Cursor sample:", cursorSample.length);
  console.log("OFFSET sample:", offsetSample.length);
  console.log("Duplicates:", dupes);
  console.log("Order mismatches:", mismatches);

  const pass =
    dupes === 0 &&
    mismatches === 0 &&
    cursorSample.length === offsetSample.length;
  console.log(pass ? "\nPASS order + eligibility parity" : "\nFAIL parity check");
  await prisma.$disconnect();
  if (!pass) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
