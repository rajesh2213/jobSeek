/**
 * Idempotent migration: re-extract atsBoardToken for companies with generic invalid tokens.
 *
 * Usage:
 *   cd apps/server && npx tsx scripts/migrations/reextractBadAtsTokens.ts [--dry-run]
 */
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";
import { fetchCareersHtmlWithMeta } from "../../src/utils/fetchCareersHtml.js";
import { extractAshbyToken } from "../../src/modules/discovery/extractors/ashby.extractor.js";
import { extractGreenhouseToken } from "../../src/modules/discovery/extractors/greenhouse.extractor.js";
import { extractLeverToken } from "../../src/modules/discovery/extractors/lever.extractor.js";
import { extractWorkdayToken } from "../../src/modules/discovery/extractors/workday.extractor.js";
import {
  INVALID_ATS_BOARD_TOKENS,
  isInvalidAtsBoardToken,
} from "../../src/modules/discovery/extractors/atsTokenValidation.js";
import type { AtsType } from "../../src/modules/ats/ats.interface.js";

loadRootEnv();

const INVALID_LIST = [...INVALID_ATS_BOARD_TOKENS];
const DRY_RUN = process.argv.includes("--dry-run");
const TAG = "bad_ats_token_migration";

function extractToken(atsType: string, html: string, careersUrl: string | null): string | null {
  if (atsType === "greenhouse") return extractGreenhouseToken(html, careersUrl);
  if (atsType === "lever") return extractLeverToken(html, careersUrl);
  if (atsType === "ashby") return extractAshbyToken(html, careersUrl);
  if (atsType === "workday") return extractWorkdayToken(html, careersUrl);
  return null;
}

function mergeTag(source: string | null, tag: string): string {
  const parts = (source ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.includes(tag)) parts.push(tag);
  return parts.join(",");
}

async function main(): Promise<void> {
  console.log(`=== Re-extract bad ATS tokens (${DRY_RUN ? "DRY RUN" : "LIVE"}) ===\n`);

  const companies = await prisma.company.findMany({
    where: {
      atsType: { in: ["ashby", "greenhouse", "lever", "workday"] },
      atsBoardToken: { in: INVALID_LIST },
    },
    select: {
      id: true,
      name: true,
      careersUrl: true,
      atsType: true,
      atsBoardToken: true,
      discoverySource: true,
    },
  });

  console.log(`Found ${companies.length} companies with invalid tokens\n`);

  const stats = { recovered: 0, cleared: 0, skipped: 0, fetchFailed: 0 };

  for (const c of companies) {
    const url = c.careersUrl?.trim();
    if (!url) {
      stats.skipped++;
      console.log(`SKIP ${c.name}: no careersUrl`);
      continue;
    }

    const meta = await fetchCareersHtmlWithMeta(url, 12_000);
    const html = meta.html ?? "";
    if (!meta.fetched || html.length < 500) {
      stats.fetchFailed++;
      if (!DRY_RUN) {
        await prisma.company.update({
          where: { id: c.id },
          data: {
            atsBoardToken: null,
            discoverySource: mergeTag(c.discoverySource, `${TAG}:unresolvable`),
          },
        });
      }
      console.log(`FAIL ${c.name}: fetch failed, ${DRY_RUN ? "would clear" : "cleared"} token`);
      continue;
    }

    const newToken = extractToken(c.atsType!, html, url);
    if (newToken && !isInvalidAtsBoardToken(newToken)) {
      stats.recovered++;
      if (!DRY_RUN) {
        await prisma.company.update({
          where: { id: c.id },
          data: {
            atsBoardToken: newToken,
            discoverySource: mergeTag(c.discoverySource, `${TAG}:recovered`),
          },
        });
      }
      console.log(`OK ${c.name}: ${c.atsBoardToken} → ${newToken.slice(0, 60)}`);
    } else {
      stats.cleared++;
      if (!DRY_RUN) {
        await prisma.company.update({
          where: { id: c.id },
          data: {
            atsBoardToken: null,
            discoverySource: mergeTag(c.discoverySource, `${TAG}:unresolvable`),
          },
        });
      }
      console.log(`CLEAR ${c.name}: could not recover (was ${c.atsBoardToken})`);
    }
  }

  const orphanBad = await prisma.atsEndpoint.count({
    where: {
      companyId: null,
      slug: { in: INVALID_LIST },
      type: { in: ["ashby", "greenhouse"] },
    },
  });

  console.log("\n=== Summary ===");
  console.log(JSON.stringify({ ...stats, orphanEndpointsWithBadSlug: orphanBad }, null, 2));
  console.log("\nNote: orphan endpoints with bad slugs are NOT deleted; re-link after company tokens fixed.");

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
