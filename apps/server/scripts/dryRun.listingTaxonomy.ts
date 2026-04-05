/**
 * Read-only dry run: junk-role listing exclusion count + simulated category mix.
 * From apps/server: npx tsx scripts/dryRun.listingTaxonomy.ts
 */
import { PrismaClient } from "@prisma/client";
import { LISTING_EXCLUDED_ROLE_SLUGS } from "../src/modules/job/jobListing.constants.js";
import { normalizeCategory } from "../src/utils/taxonomyNormalizer.js";

const prisma = new PrismaClient();
const BATCH = 4000;

async function main() {
  const excluded = [...LISTING_EXCLUDED_ROLE_SLUGS];
  const hidden = await prisma.job.count({
    where: {
      canonicalJobId: null,
      role: { in: excluded },
    },
  });
  console.log(
    "Fix 4 — canonical jobs hidden by listing role filter (would not appear in /jobs):",
    hidden,
  );

  const total = await prisma.job.count({ where: { canonicalJobId: null } });
  console.log("Canonical jobs total:", total);

  const hist = new Map<string, number>();
  let skip = 0;
  for (;;) {
    const rows = await prisma.job.findMany({
      where: { canonicalJobId: null },
      select: { title: true },
      skip,
      take: BATCH,
    });
    if (rows.length === 0) break;
    for (const r of rows) {
      const cat = normalizeCategory(r.title ?? "");
      hist.set(cat, (hist.get(cat) ?? 0) + 1);
    }
    skip += BATCH;
  }

  console.log("\nFix 2 — simulated category distribution (normalizeCategory on titles, no DB writes):");
  const sorted = [...hist.entries()].sort((a, b) => b[1] - a[1]);
  for (const [cat, n] of sorted) {
    console.log(`  ${cat}: ${n}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
