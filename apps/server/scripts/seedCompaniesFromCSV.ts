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
import { cleanCompanyInput } from "../src/utils/companyDataCleaner.js";
import { canonicalCompanyNameKey } from "../src/utils/companyNameCanonical.js";
import {
  ensureBulkHintsLoaded,
  getBulkCompanyHint,
} from "../src/utils/companyBulkHints.js";
import { shouldRejectForCsvFallback } from "../src/utils/csvFallbackNameFilter.js";

const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 250;

function readMaxFallbackInserts(): number {
  const raw = process.env.CSV_MAX_FALLBACK_INSERTS;
  if (raw === undefined || raw.trim() === "") return 1000;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 1000;
  return n;
}

function readNonnegativeInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return defaultValue;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return defaultValue;
  return n;
}

/**
 * If set, only process the first N data rows (after `CSV_SEED_SKIP_DATA_ROWS` trim). Omit for full file.
 */
function readMaxDataRows(): number | null {
  const raw = process.env.CSV_SEED_MAX_ROWS;
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

const MAX_FALLBACK_INSERTS = readMaxFallbackInserts();

/** Preferred drop-in path; repo may only ship Wellfound export under seeding/data. */
const CSV_DEFAULT_CANDIDATES = [
  ["data", "company-datasets", "companies.csv"],
  ["data", "company-datasets", "companies-01.csv"],
  ["data", "company-datasets", "companies-02.csv"],
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

  const sourceDataRows = rows.length;
  const skipDataRows = readNonnegativeInt("CSV_SEED_SKIP_DATA_ROWS", 0);
  const maxDataRows = readMaxDataRows();
  const skippedByEnv = Math.min(skipDataRows, sourceDataRows);
  const afterSkip = rows.slice(skippedByEnv);
  const workRows =
    maxDataRows == null ? afterSkip : afterSkip.slice(0, Math.max(0, maxDataRows));
  if (workRows.length === 0) {
    logger.error(
      {
        event: "csv_seed_no_rows",
        sourceDataRows,
        csvSeedSkipDataRows: skippedByEnv,
        csvSeedMaxRows: maxDataRows,
      },
      "No CSV data rows to process after CSV_SEED_SKIP_DATA_ROWS / CSV_SEED_MAX_ROWS",
    );
    process.exit(1);
  }

  const totalRows = workRows.length;
  const totalProcessed = workRows.length;

  const existingRows = await prisma.company.findMany({ select: { name: true } });
  const existingCanonicalKeys = new Set<string>();
  for (const r of existingRows) {
    const k = canonicalCompanyNameKey(r.name);
    if (k) existingCanonicalKeys.add(k);
  }
  ensureBulkHintsLoaded();

  let inserted = 0;
  let skippedDuplicates = 0;
  let emptyNameSkipped = 0;
  /** All rows where `cleanCompanyInput` failed (any reason). */
  let invalidCount = 0;
  let invalidNameNoFallback = 0;
  let fallbackInserted = 0;
  let fallbackSkippedDuplicate = 0;
  let fallbackSkippedDomainOrHint = 0;
  let fallbackSkippedLimit = 0;
  let fallbackSkippedNamePolicy = 0;
  let fallbackErrors = 0;

  const companyRepo = createCompanyRepository(prisma);
  const companyService = new CompanyService(companyRepo, createJobRepository(prisma));
  const enrichQueue = getEnrichCompanyQueue();

  for (let b = 0; b < workRows.length; b += BATCH_SIZE) {
    const batch = workRows.slice(b, b + BATCH_SIZE);
    for (const row of batch) {
      const name = normalizeNameKey(row.name);
      if (!name) {
        emptyNameSkipped += 1;
        continue;
      }

      const cleaned = cleanCompanyInput({
        name: row.name,
        website: row.website,
      });

      if (!cleaned.valid) {
        invalidCount += 1;
        if (cleaned.reason === "invalid_name") {
          invalidNameNoFallback += 1;
          continue;
        }

        if (fallbackInserted >= MAX_FALLBACK_INSERTS) {
          fallbackSkippedLimit += 1;
          continue;
        }

        const cKey = canonicalCompanyNameKey(name);
        if (cKey && existingCanonicalKeys.has(cKey)) {
          fallbackSkippedDuplicate += 1;
          continue;
        }

        const hint = getBulkCompanyHint(name);
        if (hint?.domain) {
          const hintDom = normalizeDomain(hint.domain) ?? hint.domain;
          const byHintDomain = await companyRepo.findByDomain(hintDom);
          if (byHintDomain) {
            fallbackSkippedDomainOrHint += 1;
            continue;
          }
        }

        if (await companyRepo.findByName(name)) {
          fallbackSkippedDuplicate += 1;
          continue;
        }

        const namePolicy = shouldRejectForCsvFallback(name);
        if (namePolicy.reject) {
          fallbackSkippedNamePolicy += 1;
          continue;
        }

        try {
          const company = await companyRepo.createRawCompany({
            name,
            domain: null,
            discoverySource: "csv_seed_fallback",
          });
          await companyService.enqueueCompanyEnrichment(company.id, company.name, {
            priority: ENRICH_PRIORITY_DATASET_SEED,
            jobId: `enrich-${company.id}`,
          });
          fallbackInserted += 1;
          if (cKey) existingCanonicalKeys.add(cKey);
        } catch (err) {
          fallbackErrors += 1;
          logger.warn(
            {
              event: "csv_seed_fallback_failed",
              name,
              err,
              error: err instanceof Error ? err.message : String(err),
            },
            "csv_seed_fallback_failed",
          );
        }
        continue;
      }

      const normalizedName = normalizeNameKey(cleaned.name);
      const domain = normalizeDomain(cleaned.domain) ?? cleaned.domain;
      const cKey = canonicalCompanyNameKey(normalizedName);
      if (cKey && existingCanonicalKeys.has(cKey)) {
        skippedDuplicates += 1;
        continue;
      }

      const byDomain = await companyRepo.findByDomain(domain);
      if (byDomain) {
        skippedDuplicates += 1;
        continue;
      }

      if (await companyRepo.findByName(normalizedName)) {
        skippedDuplicates += 1;
        continue;
      }

      const baseSlug = slugifyCompanyName(normalizedName);
      const slug = await ensureUniqueSlug(baseSlug);

      const company = await prisma.company.create({
        data: {
          name: normalizedName,
          slug,
          domain,
          careersUrl: `https://${domain}/careers`,
          atsType: null,
          atsBoardToken: null,
          status: CompanyStatus.raw,
          discoverySource: "csv_seed",
        },
      });

      inserted += 1;
      if (cKey) existingCanonicalKeys.add(cKey);
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

    if (b + BATCH_SIZE < workRows.length) {
      await delay(BATCH_DELAY_MS);
    }
  }

  const newCompanyRows = inserted + fallbackInserted;

  logger.info(
    {
      event: "csv_seed_summary",
      csvPath,
      sourceDataRows,
      csvSeedSkipDataRows: skippedByEnv,
      csvSeedMaxRows: maxDataRows,
      totalRows,
      totalProcessed,
      inserted,
      skippedDuplicates,
      emptyNameSkipped,
      invalidCount,
      invalidNameNoFallback,
      fallbackInserted,
      newCompanyRows,
      MAX_FALLBACK_INSERTS,
      fallbackSkippedDuplicate,
      fallbackSkippedDomainOrHint,
      fallbackSkippedLimit,
      fallbackSkippedNamePolicy,
      fallbackErrors,
    },
    "CSV company seed completed",
  );

  const failIfNoNew =
    process.env.CSV_SEED_FAIL_IF_NO_NEW === "1" || process.env.CSV_SEED_FAIL_IF_NO_NEW === "true";
  if (failIfNoNew && newCompanyRows === 0) {
    logger.error(
      {
        event: "csv_seed_no_new_inserts",
        path: csvPath,
        inserted,
        fallbackInserted,
        hint: "All rows were skipped or invalid. Try CSV_SEED_SKIP_DATA_ROWS=250 to take a different slice, or a fresh export.",
      },
      "No new company rows; aborting so chained tools (e.g. smoke) do not run on an empty seed",
    );
  }

  const closeTimeoutMs = readNonnegativeInt("CSV_ENRICH_QUEUE_CLOSE_TIMEOUT_MS", 10_000);
  try {
    await Promise.race([
      enrichQueue.close(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`enrich queue close timed out after ${closeTimeoutMs}ms`)),
          closeTimeoutMs,
        );
      }),
    ]);
  } catch (err) {
    logger.warn(
      { event: "enrich_queue_close_timeout", err, closeTimeoutMs },
      "enrichQueue.close() timed out; exit continues so downstream scripts (e.g. smoke) can run",
    );
  }

  const disconnectTimeoutMs = readNonnegativeInt("CSV_PRISMA_DISCONNECT_TIMEOUT_MS", 15_000);
  try {
    await Promise.race([
      prisma.$disconnect(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`prisma.$disconnect() timed out after ${disconnectTimeoutMs}ms`)),
          disconnectTimeoutMs,
        );
      }),
    ]);
  } catch (err) {
    logger.warn(
      { event: "prisma_disconnect_timeout", err, disconnectTimeoutMs },
      "prisma.$disconnect() timed out; process exit continues for chained tools",
    );
  }

  // Bull/Redis may otherwise keep the event loop alive and block `seed:csv && smoke` chains.
  const exitCode = failIfNoNew && newCompanyRows === 0 ? 3 : 0;
  process.exit(exitCode);
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
