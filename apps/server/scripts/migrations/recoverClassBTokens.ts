/**
 * Idempotent migration: recover atsBoardToken for Class B companies.
 *
 * Usage:
 *   cd apps/server && npx tsx scripts/migrations/recoverClassBTokens.ts [--dry-run] [--limit=N]
 */
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";
import { fetchCareersHtmlWithMeta } from "../../src/utils/fetchCareersHtml.js";
import { extractAshbyToken } from "../../src/modules/discovery/extractors/ashby.extractor.js";
import { extractGreenhouseToken } from "../../src/modules/discovery/extractors/greenhouse.extractor.js";
import { extractLeverToken } from "../../src/modules/discovery/extractors/lever.extractor.js";
import { extractWorkdayToken } from "../../src/modules/discovery/extractors/workday.extractor.js";
import { parseCrawlableBoard } from "../../src/modules/atsDiscovery/atsUrlParser.js";
import type { AtsType } from "../../src/modules/ats/ats.interface.js";

loadRootEnv();

const DRY_RUN = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 500;
const TAG = "class_b_token_recovery";

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
  console.log(`=== Class B Token Recovery (${DRY_RUN ? "DRY RUN" : "LIVE"}) ===\n`);

  const baseline = {
    withToken: await prisma.company.count({
      where: { atsBoardToken: { not: null }, NOT: { atsBoardToken: "" } },
    }),
    ready: await prisma.company.count({ where: { status: "ready" } }),
  };

  const companies = await prisma.company.findMany({
    where: {
      atsType: { in: ["greenhouse", "lever", "ashby", "workday"] },
      OR: [{ atsBoardToken: null }, { atsBoardToken: "" }],
      atsEndpoints: { none: {} },
    },
    select: {
      id: true,
      name: true,
      careersUrl: true,
      atsType: true,
      atsBoardToken: true,
      discoverySource: true,
    },
    take: LIMIT,
    orderBy: { name: "asc" },
  });

  console.log(`Candidates: ${companies.length}\n`);

  const stats = { recovered: 0, skipped: 0, fetchFailed: 0, unresolvable: 0, byAts: {} as Record<string, number> };

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
      console.log(`FETCH_FAIL ${c.name}`);
      if (!DRY_RUN) {
        await prisma.company.update({
          where: { id: c.id },
          data: { discoverySource: mergeTag(c.discoverySource, `${TAG}:fetch_failed`) },
        });
      }
      continue;
    }

    const token = extractToken(c.atsType ?? "", html, url);
    const crawlable = token ? parseCrawlableBoard(c.atsType as AtsType, token, url) : null;

    if (!token || !crawlable) {
      stats.unresolvable++;
      console.log(`UNRESOLVED ${c.name} (${c.atsType})`);
      if (!DRY_RUN) {
        await prisma.company.update({
          where: { id: c.id },
          data: { discoverySource: mergeTag(c.discoverySource, `${TAG}:unresolvable`) },
        });
      }
      continue;
    }

    const old = c.atsBoardToken?.trim() ?? null;
    if (old === token) {
      stats.skipped++;
      continue;
    }

    console.log(
      `${DRY_RUN ? "WOULD RECOVER" : "RECOVER"} ${c.name} (${c.atsType}): null → ${token.slice(0, 60)}`,
    );
    stats.recovered++;
    stats.byAts[c.atsType ?? "unknown"] = (stats.byAts[c.atsType ?? "unknown"] ?? 0) + 1;

    if (!DRY_RUN) {
      await prisma.company.update({
        where: { id: c.id },
        data: {
          atsBoardToken: token,
          discoverySource: mergeTag(c.discoverySource, `${TAG}:recovered`),
        },
      });
    }
  }

  console.log("\n=== Summary ===");
  console.log(JSON.stringify(stats, null, 2));
  console.log(`Baseline companies with token: ${baseline.withToken}`);

  if (!DRY_RUN) {
    const after = {
      withToken: await prisma.company.count({
        where: { atsBoardToken: { not: null }, NOT: { atsBoardToken: "" } },
      }),
      ready: await prisma.company.count({ where: { status: "ready" } }),
    };
    console.log(`After companies with token: ${after.withToken} (delta +${after.withToken - baseline.withToken})`);
    console.log(`After ready: ${after.ready}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
