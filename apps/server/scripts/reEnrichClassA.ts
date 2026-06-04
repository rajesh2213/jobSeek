/**
 * Re-run ATS extraction + endpoint registration for Class A / bad-token companies.
 *
 * Usage:
 *   cd apps/server && npx tsx scripts/reEnrichClassA.ts [--dry-run] [--limit N]
 */
import { loadRootEnv } from "../src/infrastructure/env/loadEnv.js";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { enrichCompany } from "../src/services/companyEnrichment.service.js";
import {
  INVALID_ATS_BOARD_TOKENS,
  isInvalidAtsBoardToken,
} from "../src/modules/discovery/extractors/atsTokenValidation.js";

loadRootEnv();

const DRY_RUN = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 500;

async function main(): Promise<void> {
  const invalidList = [...INVALID_ATS_BOARD_TOKENS];

  const companies = await prisma.company.findMany({
    where: {
      careersUrl: { not: null },
      atsType: { in: ["greenhouse", "lever", "ashby", "workday"] },
      OR: [
        { atsBoardToken: { in: invalidList } },
        {
          atsBoardToken: { not: null },
          discoverySource: { contains: "enrich_exhausted" },
        },
      ],
      NOT: {
        atsEndpoints: { some: { isActive: true } },
      },
    },
    select: {
      id: true,
      name: true,
      atsType: true,
      atsBoardToken: true,
      careersUrl: true,
      discoverySource: true,
    },
    take: LIMIT,
  });

  console.log(`Class A / bad-token re-enrich: ${companies.length} companies (${DRY_RUN ? "DRY" : "LIVE"})\n`);

  const results = { attempted: 0, endpointLinked: 0, tokenRecovered: 0, stillFailed: 0 };
  const failures: Array<{ name: string; reason: string }> = [];

  for (const c of companies) {
    results.attempted++;
    if (DRY_RUN) {
      console.log(`WOULD enrich: ${c.name} (${c.atsType}/${c.atsBoardToken})`);
      continue;
    }

    if (c.atsBoardToken && isInvalidAtsBoardToken(c.atsBoardToken)) {
      await prisma.company.update({
        where: { id: c.id },
        data: { atsBoardToken: null },
      });
    }

    if (c.discoverySource?.includes("enrich_exhausted")) {
      const next = c.discoverySource.replace(/enrich_exhausted,?/g, "").replace(/^,|,$/g, "");
      await prisma.company.update({
        where: { id: c.id },
        data: { discoverySource: next || null },
      });
    }

    try {
      await enrichCompany(c.id);
    } catch (err) {
      failures.push({
        name: c.name,
        reason: err instanceof Error ? err.message : String(err),
      });
      results.stillFailed++;
      continue;
    }

    const after = await prisma.company.findUnique({
      where: { id: c.id },
      select: { atsBoardToken: true },
    });
    const ep = await prisma.atsEndpoint.findFirst({
      where: { companyId: c.id, isActive: true },
    });

    if (ep) {
      results.endpointLinked++;
      console.log(`OK ${c.name} → endpoint ${ep.type}/${ep.slug}`);
    } else if (after?.atsBoardToken && !isInvalidAtsBoardToken(after.atsBoardToken)) {
      results.tokenRecovered++;
      console.log(`TOKEN ${c.name} → ${after.atsBoardToken?.slice(0, 50)}`);
    } else {
      results.stillFailed++;
      failures.push({ name: c.name, reason: "no endpoint after enrich" });
      console.log(`FAIL ${c.name}`);
    }
  }

  console.log("\n=== Results ===");
  console.log(JSON.stringify(results, null, 2));
  if (failures.length) {
    console.log("\nFailures (first 20):");
    for (const f of failures.slice(0, 20)) console.log(`  ${f.name}: ${f.reason}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
