/**
 * Clear `locationCity` values that are country-only noise (e.g. "Canada ()", "US & Canada").
 *
 * Usage:
 *   npx tsx src/scripts/backfillLocationCity.ts           # dry-run
 *   npx tsx src/scripts/backfillLocationCity.ts --apply   # write DB
 */
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { isCountryLevelLocation } from "../utils/locationResolver.js";

function parseArgs(argv: string[]): { apply: boolean } {
  return { apply: argv.includes("--apply") };
}

async function main(): Promise<void> {
  loadRootEnv();
  const { apply } = parseArgs(process.argv.slice(2));

  const rows = await prisma.job.findMany({
    where: {
      canonicalJobId: null,
      locationCity: { not: null },
      NOT: { locationCity: "" },
    },
    select: { id: true, locationCity: true },
  });

  const toClear = rows.filter((r) => isCountryLevelLocation(r.locationCity!));
  console.log(
    `Found ${toClear.length} jobs with country-level locationCity (${rows.length} total with city set)`,
  );

  if (toClear.length === 0) {
    await prisma.$disconnect();
    return;
  }

  const samples = new Map<string, number>();
  for (const row of toClear) {
    const k = row.locationCity!;
    samples.set(k, (samples.get(k) ?? 0) + 1);
  }
  const top = [...samples.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log("Top values to clear:");
  for (const [value, count] of top) {
    console.log(`  ${count}x  ${JSON.stringify(value)}`);
  }

  if (!apply) {
    console.log("\nDry run — pass --apply to null these locationCity values.");
    await prisma.$disconnect();
    return;
  }

  const ids = toClear.map((r) => r.id);
  const batchSize = 500;
  let updated = 0;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const result = await prisma.job.updateMany({
      where: { id: { in: batch } },
      data: { locationCity: null },
    });
    updated += result.count;
  }
  console.log(`Updated ${updated} jobs.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
