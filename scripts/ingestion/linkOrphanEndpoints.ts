/**
 * Safe linking of orphan endpoints (active, no companyId) to companies.
 *
 * Matching heuristics (in order of confidence):
 *   1. Exact slug match against Company.atsBoardToken or Company.slug
 *   2. Normalized company name match against endpoint companyName
 *   3. Domain extraction from endpoint baseUrl matching Company.domain
 *
 * Usage:
 *   npx tsx scripts/ingestion/linkOrphanEndpoints.ts [options]
 *
 * Options:
 *   --dry-run           Preview only (default: true)
 *   --no-dry-run        Execute linking
 *   --limit <n>         Max links to create (default: 20)
 *   --min-confidence <n> Minimum confidence 1-3 (default: 2)
 */

import dotenv from "dotenv";
import { resolve } from "path";
dotenv.config({ path: resolve(process.cwd(), ".env") });

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface CLIOptions {
  dryRun: boolean;
  limit: number;
  minConfidence: number;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const opts: CLIOptions = { dryRun: true, limit: 20, minConfidence: 2 };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--no-dry-run") opts.dryRun = false;
    else if (arg === "--limit" && args[i + 1]) opts.limit = Math.max(1, Math.min(100, Number(args[++i]) || 20));
    else if (arg === "--min-confidence" && args[i + 1]) opts.minConfidence = Math.max(1, Math.min(3, Number(args[++i]) || 2));
  }

  return opts;
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

async function main() {
  const opts = parseArgs();

  console.log("=== Link Orphan Endpoints ===");
  console.log(`  Mode: ${opts.dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`  Limit: ${opts.limit}`);
  console.log(`  Min confidence: ${opts.minConfidence}`);
  console.log("");

  const orphans = await prisma.atsEndpoint.findMany({
    where: { companyId: null, isActive: true },
    select: {
      id: true,
      type: true,
      slug: true,
      baseUrl: true,
      companyName: true,
    },
    take: 200,
  });

  console.log(`Found ${orphans.length} orphan active endpoints`);

  const stats = { linked: 0, no_match: 0, low_confidence: 0 };

  for (const ep of orphans) {
    if (stats.linked >= opts.limit) break;

    let matchedCompanyId: string | null = null;
    let confidence = 0;
    let matchMethod = "";

    // Method 1: slug match against atsBoardToken (confidence 3)
    const byToken = await prisma.company.findFirst({
      where: {
        atsType: ep.type,
        atsBoardToken: { contains: ep.slug, mode: "insensitive" },
      },
      select: { id: true, name: true },
    });
    if (byToken) {
      matchedCompanyId = byToken.id;
      confidence = 3;
      matchMethod = `token_match(${byToken.name})`;
    }

    // Method 2: company name match (confidence 2)
    if (!matchedCompanyId && ep.companyName) {
      const normalized = normalizeForMatch(ep.companyName);
      if (normalized.length >= 3) {
        const byName = await prisma.company.findFirst({
          where: {
            OR: [
              { slug: { contains: normalized } },
              { name: { contains: ep.companyName, mode: "insensitive" } },
            ],
          },
          select: { id: true, name: true },
        });
        if (byName) {
          matchedCompanyId = byName.id;
          confidence = 2;
          matchMethod = `name_match(${byName.name})`;
        }
      }
    }

    // Method 3: domain from baseUrl (confidence 1)
    if (!matchedCompanyId && ep.baseUrl) {
      try {
        const url = new URL(ep.baseUrl);
        const parts = url.pathname.split("/").filter(Boolean);
        const slugFromUrl = parts[0];
        if (slugFromUrl && slugFromUrl.length >= 3) {
          const byDomain = await prisma.company.findFirst({
            where: { slug: { contains: slugFromUrl.toLowerCase() } },
            select: { id: true, name: true },
          });
          if (byDomain) {
            matchedCompanyId = byDomain.id;
            confidence = 1;
            matchMethod = `url_slug_match(${byDomain.name})`;
          }
        }
      } catch { /* invalid URL */ }
    }

    if (!matchedCompanyId) {
      stats.no_match++;
      continue;
    }

    if (confidence < opts.minConfidence) {
      stats.low_confidence++;
      console.log(`  SKIP [low confidence=${confidence}] ${ep.type}/${ep.slug} → ${matchMethod}`);
      continue;
    }

    console.log(`  [${stats.linked + 1}] ${opts.dryRun ? "WOULD LINK" : "LINKING"}: ${ep.type}/${ep.slug}`);
    console.log(`       → company: ${matchMethod} (confidence=${confidence})`);

    if (!opts.dryRun) {
      await prisma.atsEndpoint.update({
        where: { id: ep.id },
        data: { companyId: matchedCompanyId },
      });
    }

    stats.linked++;
  }

  console.log("\n=== Summary ===");
  console.log(`  Mode: ${opts.dryRun ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log(`  Linked: ${stats.linked}`);
  console.log(`  No match found: ${stats.no_match}`);
  console.log(`  Low confidence skipped: ${stats.low_confidence}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("Fatal error:", e);
  await prisma.$disconnect();
  process.exit(1);
});
