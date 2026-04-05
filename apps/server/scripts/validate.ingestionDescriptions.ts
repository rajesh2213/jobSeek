/**
 * Post-change DB snapshot: description coverage (run with DATABASE_URL).
 * dedupRate and merge samples: in-process metrics / log grep (see stdout notes).
 *
 * Usage: cd apps/server && npx tsx scripts/validate.ingestionDescriptions.ts
 */
import { loadRootEnv } from "../src/infrastructure/env/loadEnv.js";
import { prisma } from "../src/infrastructure/db/prisma.js";

loadRootEnv();

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(2)}%`;
}

async function main(): Promise<void> {
  const total = await prisma.job.count();
  const rows = await prisma.$queryRaw<Array<{ c: bigint }>>`
    SELECT COUNT(*)::bigint AS c FROM "Job"
    WHERE length(trim(coalesce("description", ''))) > 120
  `;
  const over120 = Number(rows[0]?.c ?? 0);

  const bySource = await prisma.job.groupBy({
    by: ["source"],
    where: {},
    _count: { source: true },
  });

  console.log("\n=== Validation: job descriptions in DB ===\n");
  console.log(`Total job rows: ${total}`);
  console.log(`Rows with trimmed description length > 120: ${over120} (${pct(over120, total)})`);
  console.log("\nBy source (row counts):");
  for (const r of bySource.sort((a, b) => b._count.source - a._count.source)) {
    const srcTotal = r._count.source;
    const longStrict = await prisma.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*)::bigint AS c FROM "Job"
      WHERE "source" = ${r.source}
        AND length(trim(coalesce("description", ''))) > 120
    `;
    const n = Number(longStrict[0]?.c ?? 0);
    console.log(`  ${r.source}: ${srcTotal} rows, desc>120: ${n} (${pct(n, srcTotal)})`);
  }

  console.log("\n=== dedupRate ===");
  console.log(
    "dedupRate = duplicate_merges / total_ingests (in-memory jobMetrics.service counters per worker process).",
  );
  console.log(
    "Reset or observe worker logs after a crawl batch: search for event job_dedup_metrics or job_dedup_merge_decision.",
  );
  console.log("\nSample merges (titleSim / descSim): grep logs for job_dedup_merge_decision\n");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
