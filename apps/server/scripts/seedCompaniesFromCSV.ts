import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CompanyStatus } from "@prisma/client";
import { loadRootEnv } from "../src/infrastructure/env/loadEnv.js";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { logger } from "../src/utils/logger.js";
import { slugifyCompanyName } from "../src/utils/slugify.js";
import { delay, normalizeDomain } from "../src/utils/common.js";
import { createCompanyRepository } from "../src/modules/company/company.repository.js";
import { createJobRepository } from "../src/modules/job/job.repository.js";
import { CompanyService } from "../src/modules/company/company.service.js";
import {
  ENRICH_PRIORITY_DATASET_SEED,
  getEnrichCompanyQueue,
} from "../src/queues/enrich-company.queue.js";

const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 250;

/** Preferred drop-in path; repo may only ship Wellfound export under seeding/data. */
const CSV_DEFAULT_CANDIDATES = [
  ["data", "company-datasets", "companies.csv"],
  ["src", "modules", "seeding", "data", "Wellfound_Final.csv"],
] as const;

function normalizeNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]!;
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      result.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

function serverRootDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "..");
}

/**
 * Resolves CSV: `COMPANY_CSV_PATH` (env) if set, else first existing file among defaults.
 */
function resolveCsvPath(): string | null {
  const root = serverRootDir();
  const envRaw = process.env.COMPANY_CSV_PATH?.trim();
  if (envRaw) {
    const candidates = [
      envRaw,
      path.isAbsolute(envRaw) ? envRaw : path.join(process.cwd(), envRaw),
      path.join(root, envRaw),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  for (const segments of CSV_DEFAULT_CANDIDATES) {
    const p = path.join(root, ...segments);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function findColumnIndex(headers: string[], want: string): number {
  const target = want.trim().toLowerCase();
  const idx = headers.findIndex((h) => h.trim().toLowerCase() === target);
  return idx;
}

function extractHostname(websiteRaw: string | undefined): string | null {
  if (!websiteRaw?.trim()) return null;
  const trimmed = websiteRaw.trim();
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const host = new URL(withProtocol).hostname.toLowerCase();
    if (!host) return null;
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return null;
  }
}

async function ensureUniqueSlug(base: string): Promise<string> {
  let candidate = base;
  for (let n = 0; n < 10_000; n += 1) {
    const existing = await prisma.company.findUnique({
      where: { slug: candidate },
    });
    if (!existing) return candidate;
    candidate = `${base}-${n + 1}`;
  }
  throw new Error("ensureUniqueSlug: could not allocate slug");
}

interface CsvRow {
  name: string;
  website: string | undefined;
}

async function main(): Promise<void> {
  loadRootEnv();

  const csvPath = resolveCsvPath();
  if (!csvPath) {
    const root = serverRootDir();
    const defaults = CSV_DEFAULT_CANDIDATES.map((s) => path.join(root, ...s));
    logger.error(
      {
        event: "csv_missing",
        tried: process.env.COMPANY_CSV_PATH
          ? [process.env.COMPANY_CSV_PATH, ...defaults]
          : defaults,
        hint: "Set COMPANY_CSV_PATH to your CSV, or add apps/server/data/company-datasets/companies.csv",
      },
      "CSV file not found",
    );
    process.exit(1);
  }

  logger.info({ event: "csv_resolved", csvPath }, "CSV path resolved for seed");

  const raw = fs.readFileSync(csvPath, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) {
    logger.error({ event: "csv_empty" }, "CSV has no data rows");
    process.exit(1);
  }

  const headerLine = lines[0]!.replace(/^\uFEFF/, "");
  const headers = parseCsvLine(headerLine).map((h) => h.trim());
  const nameIdx = findColumnIndex(headers, "Company Name");
  const websiteIdx = findColumnIndex(headers, "Company Website URL");
  if (nameIdx < 0 || websiteIdx < 0) {
    logger.error(
      { event: "csv_header", headers, nameIdx, websiteIdx },
      'CSV must include columns "Company Name" and "Company Website URL"',
    );
    process.exit(1);
  }

  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]!);
    const name = cells[nameIdx]?.trim() ?? "";
    const website = cells[websiteIdx]?.trim();
    rows.push({ name, website: website || undefined });
  }

  const totalRows = rows.length;
  let inserted = 0;
  let skippedDuplicates = 0;
  let missingDomainCount = 0;
  let emptyNameSkipped = 0;

  const companyRepo = createCompanyRepository(prisma);
  const companyService = new CompanyService(companyRepo, createJobRepository(prisma));
  const enrichQueue = getEnrichCompanyQueue();

  for (let b = 0; b < rows.length; b += BATCH_SIZE) {
    const batch = rows.slice(b, b + BATCH_SIZE);
    for (const row of batch) {
      const name = normalizeNameKey(row.name);
      if (!name) {
        emptyNameSkipped += 1;
        continue;
      }

      const domainRaw = extractHostname(row.website);
      const domain = domainRaw ? normalizeDomain(domainRaw) ?? null : null;
      if (!domain) {
        missingDomainCount += 1;
      }

      if (domain) {
        const byDomain = await companyRepo.findByDomain(domain);
        if (byDomain) {
          skippedDuplicates += 1;
          continue;
        }
      }

      const byName = await companyRepo.findByName(name);
      if (byName) {
        skippedDuplicates += 1;
        continue;
      }

      const baseSlug = slugifyCompanyName(name);
      const slug = await ensureUniqueSlug(baseSlug);

      const company = await prisma.company.create({
        data: {
          name,
          slug,
          domain,
          careersUrl: domain ? `https://${domain}/careers` : null,
          atsType: null,
          atsBoardToken: null,
          status: CompanyStatus.raw,
          discoverySource: "csv_seed",
        },
      });

      inserted += 1;
      try {
        await companyService.enqueueCompanyEnrichment(company.id, company.name, {
          priority: ENRICH_PRIORITY_DATASET_SEED,
          jobId: `enrich-${company.id}`,
        });
      } catch (err) {
        logger.warn(
          { event: "enqueue_enrich_after_csv_seed_failed", companyId: company.id, err },
          "Could not enqueue enrichment after CSV seed row",
        );
      }
    }

    if (b + BATCH_SIZE < rows.length) {
      await delay(BATCH_DELAY_MS);
    }
  }

  await enrichQueue.close();

  logger.info(
    {
      event: "csv_seed_summary",
      csvPath,
      totalRows,
      inserted,
      skippedDuplicates,
      missingDomainCount,
      emptyNameSkipped,
    },
    "CSV company seed completed",
  );

  await prisma.$disconnect();
}

void main().catch(async (err) => {
  logger.error({ event: "csv_seed_failed", err }, "CSV company seed failed");
  try {
    await getEnrichCompanyQueue().close();
  } catch {
    /* ignore */
  }
  await prisma.$disconnect();
  process.exit(1);
});
