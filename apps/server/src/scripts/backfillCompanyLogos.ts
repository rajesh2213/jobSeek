/**
 * Backfill Company.logoUrl: Clearbit → GitHub favicons → Google s2 favicon.
 *
 *   cd apps/server && npx tsx src/scripts/backfillCompanyLogos.ts --dry-run
 *   cd apps/server && npx tsx src/scripts/backfillCompanyLogos.ts
 *   cd apps/server && npx tsx src/scripts/backfillCompanyLogos.ts --force
 *   cd apps/server && npx tsx src/scripts/backfillCompanyLogos.ts --domain openai.com
 */
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { delay, normalizeDomain } from "../utils/common.js";
import {
  resolveCompanyLogoWithSource,
  type CompanyLogoSource,
} from "../utils/companyLogo.js";

const CONCURRENCY = 5;
const BATCH_DELAY_MS = 200;

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const force = argv.includes("--force");
  let domain: string | null = null;
  const idx = argv.indexOf("--domain");
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith("--")) {
    domain = argv[idx + 1];
  }
  const eq = argv.find((a) => a.startsWith("--domain="));
  if (eq) domain = eq.slice("--domain=".length).trim() || null;
  return { dryRun, force, domain };
}

const { dryRun, force, domain: domainFilter } = parseArgs(process.argv.slice(2));

type RowResult =
  | { kind: CompanyLogoSource; wrote: boolean }
  | { kind: "skipped" }
  | { kind: "failed" };

function sourceLabel(source: CompanyLogoSource): string {
  switch (source) {
    case "clearbit":
      return "clearbit";
    case "github":
      return "github favicons";
    case "google":
      return "google favicon";
    default:
      return source;
  }
}

async function main(): Promise<void> {
  loadRootEnv();

  if (domainFilter) {
    const normalized = normalizeDomain(domainFilter);
    if (!normalized) {
      console.error(`Invalid domain: ${domainFilter}`);
      process.exitCode = 1;
      return;
    }

    const company = await prisma.company.findFirst({
      where: {
        domain: { equals: normalized, mode: "insensitive" },
      },
      select: { id: true, domain: true, name: true },
    });

    if (!company) {
      console.error(`No company found with domain matching: ${domainFilter} (normalized: ${normalized})`);
      process.exitCode = 1;
      return;
    }

    const domain = company.domain?.trim() ?? "";
    try {
      const resolved = await resolveCompanyLogoWithSource(domain);
      if (!resolved) {
        console.log(`${domain} → skipped (invalid domain for logo resolution)`);
        return;
      }
      console.log(
        `${domain} → source=${sourceLabel(resolved.source)} (${resolved.source}) url=${resolved.url}`,
      );

      if (!dryRun) {
        await prisma.company.update({
          where: { id: company.id },
          data: { logoUrl: resolved.url },
        });
        console.log(`Updated company "${company.name}" (id=${company.id})`);
      } else {
        console.log("(dry-run: no DB write)");
      }
    } catch (err) {
      console.error(`${domain} → FAILED`, err);
      process.exitCode = 1;
    }
    return;
  }

  const companies = await prisma.company.findMany({
    where: force
      ? {
          AND: [{ domain: { not: null } }, { NOT: { domain: "" } }],
        }
      : {
          AND: [
            {
              OR: [{ logoUrl: null }, { logoUrl: "" }],
            },
            { domain: { not: null } },
            { NOT: { domain: "" } },
          ],
        },
    select: { id: true, domain: true },
    orderBy: { id: "asc" },
  });

  const total = companies.length;
  let updated = 0;
  let clearbit = 0;
  let github = 0;
  let google = 0;
  let failed = 0;
  let skipped = 0;

  const processOne = async (
    row: (typeof companies)[0],
    index1: number,
  ): Promise<RowResult> => {
    const domain = row.domain?.trim() ?? "";
    const i = index1;
    try {
      const resolved = await resolveCompanyLogoWithSource(domain);
      if (!resolved) {
        console.log(`[${i}/${total}] ${domain || "(empty)"} → skipped (invalid domain)`);
        return { kind: "skipped" };
      }
      console.log(
        `[${i}/${total}] ${domain} → ${sourceLabel(resolved.source)} url=${resolved.url}`,
      );

      if (dryRun) {
        return { kind: resolved.source, wrote: false };
      }

      await prisma.company.update({
        where: { id: row.id },
        data: { logoUrl: resolved.url },
      });
      return { kind: resolved.source, wrote: true };
    } catch (err) {
      console.error(`[${i}/${total}] ${domain} → FAILED`, err);
      return { kind: "failed" };
    }
  };

  for (let i = 0; i < companies.length; i += CONCURRENCY) {
    const batch = companies.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((row, j) => processOne(row, i + j + 1)),
    );
    for (const r of results) {
      if (r.kind === "skipped") skipped += 1;
      else if (r.kind === "failed") failed += 1;
      else {
        if (r.kind === "clearbit") clearbit += 1;
        else if (r.kind === "github") github += 1;
        else google += 1;
        if (r.wrote) updated += 1;
      }
    }
    if (i + CONCURRENCY < companies.length) {
      await delay(BATCH_DELAY_MS);
    }
  }

  console.log("\n=== Summary ===");
  console.log(
    JSON.stringify(
      {
        updated: dryRun ? 0 : updated,
        clearbit,
        github,
        google,
        failed,
        skipped,
        dryRun,
        force,
        total,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
