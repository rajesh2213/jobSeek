/**
 * Re-enrich Class A / post-migration companies (rollout execution).
 * Usage: npx tsx scripts/rollout/slugFixReEnrichClassA.ts [--dry-run] [--limit=N]
 */
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";
import { processEnrichCompany } from "../../src/services/companyEnrichment.service.js";
import {
  INVALID_ATS_BOARD_TOKENS,
  isInvalidAtsBoardToken,
} from "../../src/modules/discovery/extractors/atsTokenValidation.js";

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
      NOT: { atsEndpoints: { some: { isActive: true } } },
      OR: [
        { discoverySource: { contains: "enrich_exhausted" } },
        { discoverySource: { contains: "bad_ats_token_migration" } },
        { atsBoardToken: { in: invalidList } },
      ],
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

  const candidates = companies.filter(
    (c) =>
      (c.atsBoardToken && invalidList.includes(c.atsBoardToken)) ||
      c.discoverySource?.includes("enrich_exhausted") ||
      c.discoverySource?.includes("bad_ats_token_migration"),
  );

  console.log(`Re-enrich candidates: ${candidates.length} (${DRY_RUN ? "DRY" : "LIVE"})\n`);

  const log: Array<Record<string, string | boolean | null>> = [];

  for (const c of candidates) {
    const reason = c.discoverySource?.includes("enrich_exhausted")
      ? "enrich_exhausted"
      : c.discoverySource?.includes("bad_ats_token_migration")
        ? "post_migration"
        : "no_endpoint";

    log.push({
      company: c.name,
      atsType: c.atsType,
      currentToken: c.atsBoardToken?.slice(0, 80) ?? null,
      reason,
    });

    if (DRY_RUN) {
      console.log(`WOULD enrich: ${c.name} (${c.atsType}) token=${c.atsBoardToken} reason=${reason}`);
      continue;
    }

    if (c.discoverySource?.includes("enrich_exhausted")) {
      const next = c.discoverySource.replace(/enrich_exhausted,?/g, "").replace(/^,|,$/g, "");
      await prisma.company.update({
        where: { id: c.id },
        data: { discoverySource: next || null },
      });
    }

    try {
      await processEnrichCompany(prisma, c.id);
    } catch (err) {
      console.log(`FAIL ${c.name}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const after = await prisma.company.findUnique({
      where: { id: c.id },
      select: { atsBoardToken: true },
    });
    const ep = await prisma.atsEndpoint.findFirst({
      where: { companyId: c.id, isActive: true },
    });
    console.log(
      ep
        ? `OK ${c.name} → endpoint ${ep.type}/${ep.slug}`
        : `PARTIAL ${c.name} token=${after?.atsBoardToken?.slice(0, 40) ?? "null"}`,
    );
  }

  const results = { dryRun: DRY_RUN, candidates: candidates.length, log };
  console.log("\n" + JSON.stringify(results, null, 2));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
