/**
 * Class B token recovery dry-run — no DB writes.
 *
 * Usage:
 *   npx tsx scripts/audit/classBTokenRecovery.ts [--limit=N]
 */
import dotenv from "dotenv";
import { resolve } from "path";
dotenv.config({ path: resolve(process.cwd(), ".env") });

import { PrismaClient } from "@prisma/client";
import { fetchCareersHtmlWithMeta } from "../../apps/server/src/utils/fetchCareersHtml.js";
import { extractAshbyToken } from "../../apps/server/src/modules/discovery/extractors/ashby.extractor.js";
import { extractGreenhouseToken } from "../../apps/server/src/modules/discovery/extractors/greenhouse.extractor.js";
import { extractLeverToken } from "../../apps/server/src/modules/discovery/extractors/lever.extractor.js";
import { extractWorkdayToken } from "../../apps/server/src/modules/discovery/extractors/workday.extractor.js";
import { parseCrawlableBoard } from "../../apps/server/src/modules/atsDiscovery/atsUrlParser.js";
import type { AtsType } from "../../apps/server/src/modules/ats/ats.interface.js";

const prisma = new PrismaClient();
const FETCH_MS = 12_000;
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 500;

function extractToken(atsType: string, html: string, url: string): string | null {
  if (atsType === "greenhouse") return extractGreenhouseToken(html, url);
  if (atsType === "lever") return extractLeverToken(html, url);
  if (atsType === "ashby") return extractAshbyToken(html, url);
  if (atsType === "workday") return extractWorkdayToken(html, url);
  return null;
}

async function main(): Promise<void> {
  console.log("=== Class B Token Recovery (DRY RUN) ===\n");

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
    },
    take: LIMIT,
    orderBy: { name: "asc" },
  });

  console.log(`Companies scanned: ${companies.length}\n`);
  console.log("| Company | ATS | Old Token | New Token |");
  console.log("|---------|-----|-----------|-----------|");

  const stats = {
    scanned: companies.length,
    recovered: 0,
    unresolved: 0,
    fetchFailed: 0,
    byAtsType: {} as Record<string, { recovered: number; unresolved: number }>,
  };

  for (const c of companies) {
    const ats = c.atsType ?? "unknown";
    if (!stats.byAtsType[ats]) stats.byAtsType[ats] = { recovered: 0, unresolved: 0 };

    const url = c.careersUrl?.trim();
    if (!url) {
      stats.unresolved++;
      stats.byAtsType[ats].unresolved++;
      console.log(`| ${c.name} | ${ats} | null | (no careersUrl) |`);
      continue;
    }

    const meta = await fetchCareersHtmlWithMeta(url, FETCH_MS);
    const html = meta.html ?? "";
    if (!meta.fetched || html.length < 500) {
      stats.fetchFailed++;
      stats.unresolved++;
      stats.byAtsType[ats].unresolved++;
      console.log(`| ${c.name} | ${ats} | null | (fetch failed) |`);
      continue;
    }

    const token = extractToken(ats, html, url);
    const crawlable = token ? parseCrawlableBoard(ats as AtsType, token, url) != null : false;

    if (crawlable && token) {
      stats.recovered++;
      stats.byAtsType[ats].recovered++;
      console.log(`| ${c.name} | ${ats} | null | ${token.slice(0, 50)} |`);
    } else {
      stats.unresolved++;
      stats.byAtsType[ats].unresolved++;
      console.log(`| ${c.name} | ${ats} | null | — |`);
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Companies scanned: ${stats.scanned}`);
  console.log(`Tokens recovered: ${stats.recovered}`);
  console.log(`Still unresolved: ${stats.unresolved}`);
  console.log(`Fetch failed: ${stats.fetchFailed}`);
  console.log("By ATS type:", JSON.stringify(stats.byAtsType, null, 2));

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
