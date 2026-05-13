/**
 * Safe incremental materialization of AtsEndpoint records for companies
 * that have atsType + atsBoardToken set but no corresponding endpoint.
 *
 * Usage:
 *   npx tsx scripts/ingestion/materializeMissingEndpoints.ts [options]
 *
 * Options:
 *   --dry-run          Preview only, no writes (default: true)
 *   --no-dry-run       Actually create endpoints
 *   --limit <n>        Max endpoints to create (default: 25)
 *   --provider <type>  Only process this ATS provider
 *   --only-active-companies  Only companies with status='ready'
 *   --delay-ms <n>     Delay between inserts (default: 200)
 */

import dotenv from "dotenv";
import { resolve } from "path";
dotenv.config({ path: resolve(process.cwd(), ".env") });

import { PrismaClient, Prisma } from "@prisma/client";
import {
  parseCrawlableBoard,
  type AtsEndpointParseResult,
} from "../../apps/server/src/modules/atsDiscovery/atsUrlParser.js";
import { CRAWLABLE_ATS_TYPES } from "../../apps/server/src/modules/ats/ats.interface.js";

const prisma = new PrismaClient();

interface CLIOptions {
  dryRun: boolean;
  limit: number;
  provider: string | null;
  onlyActiveCompanies: boolean;
  delayMs: number;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const opts: CLIOptions = {
    dryRun: true,
    limit: 25,
    provider: null,
    onlyActiveCompanies: false,
    delayMs: 200,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--no-dry-run") opts.dryRun = false;
    else if (arg === "--limit" && args[i + 1]) opts.limit = Math.max(1, Math.min(200, Number(args[++i]) || 25));
    else if (arg === "--provider" && args[i + 1]) opts.provider = args[++i]!;
    else if (arg === "--only-active-companies") opts.onlyActiveCompanies = true;
    else if (arg === "--delay-ms" && args[i + 1]) opts.delayMs = Math.max(50, Number(args[++i]) || 200);
  }

  return opts;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const opts = parseArgs();
  const crawlableSet = new Set<string>(CRAWLABLE_ATS_TYPES);

  console.log("=== Materialize Missing Endpoints ===");
  console.log(`  Mode: ${opts.dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`  Limit: ${opts.limit}`);
  console.log(`  Provider filter: ${opts.provider ?? "all crawlable"}`);
  console.log(`  Only active companies: ${opts.onlyActiveCompanies}`);
  console.log(`  Delay: ${opts.delayMs}ms`);
  console.log("");

  if (opts.provider && !crawlableSet.has(opts.provider)) {
    console.error(`Provider '${opts.provider}' is not crawlable. Valid: ${CRAWLABLE_ATS_TYPES.join(", ")}`);
    process.exit(1);
  }

  const where: Prisma.CompanyWhereInput = {
    atsType: opts.provider ? { equals: opts.provider } : { not: null },
    atsBoardToken: { not: null },
    ...(opts.onlyActiveCompanies ? { status: "ready" } : {}),
    atsEndpoints: { none: {} },
  };

  const candidates = await prisma.company.findMany({
    where,
    select: {
      id: true,
      name: true,
      atsType: true,
      atsBoardToken: true,
      careersUrl: true,
      status: true,
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    take: opts.limit * 3,
  });

  console.log(`Found ${candidates.length} candidate companies (fetched up to ${opts.limit * 3})`);

  const stats = {
    created: 0,
    skipped_not_crawlable: 0,
    skipped_malformed_token: 0,
    skipped_duplicate: 0,
    skipped_empty_slug: 0,
    errors: 0,
    by_provider: {} as Record<string, number>,
  };

  let processed = 0;

  for (const company of candidates) {
    if (stats.created >= opts.limit) break;

    const atsType = company.atsType!;
    const token = company.atsBoardToken!;

    if (!crawlableSet.has(atsType)) {
      stats.skipped_not_crawlable++;
      continue;
    }

    let parsed: AtsEndpointParseResult | null;
    try {
      parsed = parseCrawlableBoard(atsType as any, token, company.careersUrl);
    } catch {
      stats.skipped_malformed_token++;
      continue;
    }

    if (!parsed || !parsed.slug || !parsed.baseUrl) {
      stats.skipped_malformed_token++;
      if (!opts.dryRun) {
        console.log(`  SKIP [malformed] ${company.name} | ${atsType} | token=${token.slice(0, 50)}`);
      }
      continue;
    }

    const existing = await prisma.atsEndpoint.findUnique({
      where: { type_slug: { type: parsed.type, slug: parsed.slug } },
      select: { id: true },
    });

    if (existing) {
      stats.skipped_duplicate++;
      continue;
    }

    processed++;
    console.log(`  [${processed}] ${opts.dryRun ? "WOULD CREATE" : "CREATING"}: ${company.name}`);
    console.log(`       type=${parsed.type} slug=${parsed.slug}`);
    console.log(`       baseUrl=${parsed.baseUrl}`);
    console.log(`       company=${company.id} status=${company.status}`);

    if (!opts.dryRun) {
      try {
        await prisma.atsEndpoint.create({
          data: {
            type: parsed.type,
            slug: parsed.slug,
            baseUrl: parsed.baseUrl,
            metadata: { crawlToken: parsed.crawlToken },
            companyId: company.id,
            companyName: company.name,
            isActive: false,
            score: 5,
            source: "materialization_script",
          },
        });
        stats.created++;
        stats.by_provider[parsed.type] = (stats.by_provider[parsed.type] ?? 0) + 1;
        await sleep(opts.delayMs);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          stats.skipped_duplicate++;
          console.log(`       → Duplicate (race), skipped`);
        } else {
          stats.errors++;
          console.error(`       → ERROR: ${err}`);
        }
      }
    } else {
      stats.created++;
      stats.by_provider[parsed.type] = (stats.by_provider[parsed.type] ?? 0) + 1;
    }
  }

  console.log("\n=== Summary ===");
  console.log(`  Mode: ${opts.dryRun ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log(`  Created: ${stats.created}`);
  console.log(`  Skipped (not crawlable): ${stats.skipped_not_crawlable}`);
  console.log(`  Skipped (malformed token): ${stats.skipped_malformed_token}`);
  console.log(`  Skipped (duplicate): ${stats.skipped_duplicate}`);
  console.log(`  Skipped (empty slug): ${stats.skipped_empty_slug}`);
  console.log(`  Errors: ${stats.errors}`);
  console.log(`  Provider distribution:`);
  for (const [prov, count] of Object.entries(stats.by_provider).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${prov}: ${count}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("Fatal error:", e);
  await prisma.$disconnect();
  process.exit(1);
});
