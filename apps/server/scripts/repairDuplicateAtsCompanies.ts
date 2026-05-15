/**
 * Merge duplicate Company rows that share the same ATS board token.
 * Fixes production cases like REDDI (reddi) vs Reddit (reddit) on greenhouse/reddit.
 *
 * Usage:
 *   npx tsx apps/server/scripts/repairDuplicateAtsCompanies.ts [--dry-run]
 *   npx tsx apps/server/scripts/repairDuplicateAtsCompanies.ts --slug reddi --dry-run
 */
import { loadRootEnv } from "../src/infrastructure/env/loadEnv.js";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { pickCanonicalCompany } from "../src/utils/companyCanonical.js";
import { companyDisplayName } from "../src/utils/companyDisplayName.js";

const dryRun = process.argv.includes("--dry-run");
const slugFilter = (() => {
  const i = process.argv.indexOf("--slug");
  return i >= 0 ? process.argv[i + 1]?.trim() : undefined;
})();

async function main(): Promise<void> {
  loadRootEnv();

  const dupGroups = await prisma.$queryRaw<
    Array<{ atsType: string; atsBoardToken: string; count: bigint }>
  >`
    SELECT "atsType", "atsBoardToken", COUNT(*)::bigint AS count
    FROM "Company"
    WHERE "atsType" IS NOT NULL
      AND "atsBoardToken" IS NOT NULL
      AND TRIM("atsBoardToken") <> ''
    GROUP BY "atsType", "atsBoardToken"
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  `;

  let merged = 0;
  for (const g of dupGroups) {
    const companies = await prisma.company.findMany({
      where: { atsType: g.atsType, atsBoardToken: g.atsBoardToken },
    });
    const canonical = pickCanonicalCompany(companies);
    if (!canonical) continue;

    const duplicates = companies.filter((c) => c.id !== canonical.id);
    for (const dup of duplicates) {
      if (slugFilter && dup.slug !== slugFilter && canonical.slug !== slugFilter) continue;

      const jobCount = await prisma.job.count({ where: { companyId: dup.id } });
      console.log(
        `[${dryRun ? "dry-run" : "merge"}] ${dup.name} (${dup.slug}) -> ${canonical.name} (${canonical.slug}) | jobs=${jobCount} board=${g.atsType}/${g.atsBoardToken}`,
      );

      if (dryRun) continue;

      await prisma.$transaction(async (tx) => {
        await tx.job.updateMany({
          where: { companyId: dup.id },
          data: { companyId: canonical.id },
        });
        await tx.atsEndpoint.updateMany({
          where: { companyId: dup.id },
          data: {
            companyId: canonical.id,
            companyName: companyDisplayName(canonical.name, canonical.domain),
          },
        });
        await tx.company.delete({ where: { id: dup.id } });
      });
      merged += 1;
    }
  }

  console.log(JSON.stringify({ dryRun, duplicateGroups: dupGroups.length, merged }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
