/**
 * Link orphan endpoints (active, no companyId) to companies — confidence 3 only.
 *
 * Matching (in order):
 *   1. Exact type + slug match: endpoint.slug === company.atsBoardToken (confidence 3)
 *   2. Workday: endpoint slug matches encoded company workday token
 *
 * Usage:
 *   npx tsx scripts/ingestion/linkOrphanEndpoints.ts [--dry-run] [--limit N]
 */
import dotenv from "dotenv";
import { resolve } from "path";
dotenv.config({ path: resolve(process.cwd(), ".env") });

import { PrismaClient } from "@prisma/client";
import { isInvalidAtsBoardToken } from "../../apps/server/src/modules/discovery/extractors/atsTokenValidation.js";
import { buildWorkdaySlug, parseWorkdayBoardToken } from "../../apps/server/src/modules/atsDiscovery/atsUrlParser.js";

const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 500;

async function main(): Promise<void> {
  console.log(`=== Link Orphan Endpoints (confidence 3 only) ${DRY_RUN ? "DRY RUN" : "LIVE"} ===\n`);

  const orphans = await prisma.atsEndpoint.findMany({
    where: { companyId: null, isActive: true },
    select: { id: true, type: true, slug: true, baseUrl: true, companyName: true },
    take: LIMIT,
  });

  console.log(`Orphans to process: ${orphans.length}\n`);

  const stats = { linked: 0, noMatch: 0, alreadyHasEndpoint: 0, invalidSlug: 0 };

  for (const ep of orphans) {
    if (isInvalidAtsBoardToken(ep.slug)) {
      stats.invalidSlug++;
      continue;
    }

    let matched: { id: string; name: string } | null = null;
    let strategy = "";

    if (ep.type === "workday") {
      const companies = await prisma.company.findMany({
        where: { atsType: "workday", atsBoardToken: { not: null } },
        select: { id: true, name: true, atsBoardToken: true },
        take: 2000,
      });
      for (const c of companies) {
        const parts = parseWorkdayBoardToken(c.atsBoardToken ?? "");
        if (!parts) continue;
        const slug = buildWorkdaySlug(parts);
        if (slug === ep.slug) {
          matched = { id: c.id, name: c.name };
          strategy = "workday_slug_match";
          break;
        }
      }
    } else {
      const bySlug = await prisma.company.findFirst({
        where: {
          atsType: ep.type,
          atsBoardToken: ep.slug,
        },
        select: { id: true, name: true },
      });
      if (bySlug) {
        matched = bySlug;
        strategy = "exact_type_slug_token";
      }
    }

    if (!matched) {
      stats.noMatch++;
      continue;
    }

    const existing = await prisma.atsEndpoint.count({
      where: { companyId: matched.id, isActive: true },
    });
    if (existing > 0) {
      stats.alreadyHasEndpoint++;
      continue;
    }

    console.log(
      `${DRY_RUN ? "WOULD LINK" : "LINK"} ${ep.type}/${ep.slug} → ${matched.name} (${strategy})`,
    );

    if (!DRY_RUN) {
      await prisma.atsEndpoint.update({
        where: { id: ep.id },
        data: { companyId: matched.id },
      });
    }
    stats.linked++;
  }

  console.log("\n=== Summary ===");
  console.log(JSON.stringify(stats, null, 2));

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
