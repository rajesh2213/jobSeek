/**
 * Link Class A collision companies to existing shared ATS endpoints (M:N).
 * Only links when company token parses to the same type/slug as an existing endpoint.
 *
 * Usage:
 *   cd apps/server && npx tsx scripts/migrations/linkSharedBoardCollisions.ts [--dry-run] [--limit=N]
 */
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";
import { parseCrawlableBoard } from "../../src/modules/atsDiscovery/atsUrlParser.js";
import type { AtsType } from "../../src/modules/ats/ats.interface.js";
import { linkCompanyToEndpoint } from "../../src/modules/companyEndpoint/companyEndpointLink.service.js";
import { mergeTag, ACTIVATION_TAG } from "../rollout/classBActivationLib.js";
import { isInvalidAtsBoardToken } from "../../src/modules/discovery/extractors/atsTokenValidation.js";

loadRootEnv();

const DRY_RUN = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 100;

async function main(): Promise<void> {
  console.log(`=== Link Shared Board Collisions (${DRY_RUN ? "DRY RUN" : "LIVE"}) ===\n`);

  const candidates = await prisma.$queryRaw<
    Array<{
      id: string;
      name: string;
      atsType: string;
      atsBoardToken: string;
      careersUrl: string | null;
      discoverySource: string | null;
    }>
  >`
    SELECT c.id, c.name, c."atsType", c."atsBoardToken", c."careersUrl", c."discoverySource"
    FROM "Company" c
    WHERE c."atsType" IN ('greenhouse', 'lever', 'ashby', 'workday')
      AND c."atsBoardToken" IS NOT NULL
      AND TRIM(c."atsBoardToken") <> ''
      AND NOT EXISTS (
        SELECT 1 FROM "AtsEndpoint" e WHERE e."companyId" = c.id AND e."isActive" = true
      )
      AND NOT EXISTS (
        SELECT 1 FROM "CompanyAtsEndpoint" l
        JOIN "AtsEndpoint" e ON e.id = l."endpointId"
        WHERE l."companyId" = c.id AND e."isActive" = true
      )
    ORDER BY c.name ASC
    LIMIT ${LIMIT * 3}
  `;

  const stats = { linked: 0, skipped_no_match: 0, skipped_invalid: 0, skipped_owned: 0 };

  for (const c of candidates) {
    if (stats.linked >= LIMIT) break;

    if (isInvalidAtsBoardToken(c.atsBoardToken)) {
      stats.skipped_invalid++;
      continue;
    }

    const parsed = parseCrawlableBoard(c.atsType as AtsType, c.atsBoardToken, c.careersUrl);
    if (!parsed) {
      stats.skipped_no_match++;
      continue;
    }

    const globalEp = await prisma.atsEndpoint.findUnique({
      where: { type_slug: { type: parsed.type, slug: parsed.slug } },
      select: { id: true, companyId: true, isActive: true, type: true, slug: true },
    });

    if (!globalEp || globalEp.companyId === c.id || globalEp.companyId == null) {
      stats.skipped_owned++;
      continue;
    }

    console.log(
      `${DRY_RUN ? "WOULD LINK" : "LINK"} ${c.name} → ${globalEp.type}/${globalEp.slug} (owner=${globalEp.companyId})`,
    );

    if (!DRY_RUN) {
      await linkCompanyToEndpoint(prisma, {
        companyId: c.id,
        endpointId: globalEp.id,
        source: "shared_board_collision",
      });
      await prisma.company.update({
        where: { id: c.id },
        data: {
          discoverySource: mergeTag(c.discoverySource, `${ACTIVATION_TAG}:shared_board`),
        },
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
