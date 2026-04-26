import { loadRootEnv } from "../src/infrastructure/env/loadEnv.js";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { logger } from "../src/utils/logger.js";
import { createCompanyRepository } from "../src/modules/company/company.repository.js";
import { CompanyService } from "../src/modules/company/company.service.js";
import { createJobRepository } from "../src/modules/job/job.repository.js";
import { SeedingService } from "../src/modules/seeding/seeding.service.js";
import type { SeedCompany } from "../src/modules/seeding/seeding.types.js";
import { getYcDataset } from "../src/modules/seeding/datasets/yc.dataset.js";
import { getStartupsDataset } from "../src/modules/seeding/datasets/startups.dataset.js";
import { getGithubDataset } from "../src/modules/seeding/datasets/github.dataset.js";
import { getEnterpriseDataset } from "../src/modules/seeding/datasets/enterprise.dataset.js";
import { getExtendedDataset } from "../src/modules/seeding/datasets/extended.dataset.js";
import { cleanCompanyInput } from "../src/utils/companyDataCleaner.js";

function normalizeNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeDomain(domain: string | undefined): string | undefined {
  if (!domain) return undefined;
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
}

const GENERIC_NAME_BLOCKLIST = new Set([
  "unknown",
  "test",
  "company",
  "n/a",
  "na",
  "tbd",
  "placeholder",
  "none",
  "null",
  "undefined",
]);

function isTooGenericName(name: string): boolean {
  const key = normalizeNameKey(name);
  if (key.length < 2) return true;
  if (GENERIC_NAME_BLOCKLIST.has(key)) return true;
  const words = key.split(" ").filter(Boolean);
  if (words.length === 1 && words[0].length < 3) return true;
  return false;
}

function dedupeSeedCompanies(companies: SeedCompany[]): SeedCompany[] {
  const deduped = new Map<string, SeedCompany>();

  for (const company of companies) {
    const nameKey = normalizeNameKey(company.name);
    const domainKey = normalizeDomain(company.domain);
    const key = domainKey ? `domain:${domainKey}` : `name:${nameKey}`;
    if (!nameKey || deduped.has(key)) continue;

    deduped.set(key, {
      name: company.name.trim(),
      domain: domainKey,
    });
  }

  return Array.from(deduped.values());
}

function parsePositiveIntEnv(name: string): number | null {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer when set`);
  }
  return n;
}

async function main(): Promise<void> {
  loadRootEnv();

  const ycDataset = getYcDataset();
  const startupsDataset = getStartupsDataset();
  const githubDataset = getGithubDataset();
  const enterpriseDataset = getEnterpriseDataset();
  const extendedDataset = getExtendedDataset();

  logger.info(
    {
      event: "seed_dataset_size",
      yc: ycDataset.length,
      startups: startupsDataset.length,
      github: githubDataset.length,
      enterprise: enterpriseDataset.length,
      extended: extendedDataset.length,
    },
    "Seeding dataset sizes",
  );

  const raw = [
    ...ycDataset,
    ...startupsDataset,
    ...githubDataset,
    ...enterpriseDataset,
    ...extendedDataset,
  ];

  const totalProcessed = raw.length;
  let invalidCount = 0;
  let validationSkipped = 0;
  const validated: SeedCompany[] = [];
  for (const c of raw) {
    const cleaned = cleanCompanyInput({
      name: c.name,
      website: c.domain,
    });
    if (!cleaned.valid) {
      invalidCount += 1;
      continue;
    }
    if (isTooGenericName(cleaned.name)) {
      validationSkipped += 1;
      continue;
    }
    validated.push({ name: cleaned.name, domain: cleaned.domain });
  }

  logger.info(
    {
      event: "company_cleaning_summary",
      invalidCount,
      totalProcessed,
    },
    "Company input cleaning (TS seed)",
  );

  if (validationSkipped > 0) {
    logger.info(
      { event: "seed_validation_skipped", count: validationSkipped },
      "Skipped generic or invalid seed names",
    );
  }

  const companies = dedupeSeedCompanies(validated);
  const batchSize = parsePositiveIntEnv("BATCH_SIZE") ?? companies.length;
  const batchIndex = parsePositiveIntEnv("BATCH_INDEX") ?? 1;
  const totalBatches = Math.max(1, Math.ceil(companies.length / batchSize));

  if (batchIndex > totalBatches) {
    throw new Error(
      `BATCH_INDEX out of range: got ${batchIndex}, total batches ${totalBatches} for BATCH_SIZE=${batchSize}`,
    );
  }

  const start = (batchIndex - 1) * batchSize;
  const end = Math.min(start + batchSize, companies.length);
  const batchCompanies = companies.slice(start, end);

  logger.info(
    {
      event: "seed_start",
      total_companies: companies.length,
      raw_count: raw.length,
      batch_size: batchSize,
      batch_index: batchIndex,
      total_batches: totalBatches,
      batch_count: batchCompanies.length,
      batch_start_index: start,
      batch_end_index_exclusive: end,
    },
    "Company seeding started",
  );

  const companyService = new CompanyService(
    createCompanyRepository(prisma),
    createJobRepository(prisma),
  );
  const seedingService = new SeedingService(companyService);

  const result = await seedingService.seedCompanies(batchCompanies);

  logger.info(
    {
      event: "seed_summary",
      inserted: result.inserted,
      skipped: result.skipped,
      batch_size: batchSize,
      batch_index: batchIndex,
      total_batches: totalBatches,
      batch_count: batchCompanies.length,
    },
    "Company seeding completed",
  );

  await prisma.$disconnect();
}

void main().catch(async (err) => {
  logger.error({ event: "seed_failed", err }, "Company seeding failed");
  await prisma.$disconnect();
  process.exit(1);
});
