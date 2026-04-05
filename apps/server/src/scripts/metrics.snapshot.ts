import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { buildMetricsSnapshot } from "../services/metricsSnapshot.service.js";
import { logger } from "../utils/logger.js";

function formatPct(value: number): string {
  return `${value.toFixed(2)}%`;
}

function printDensityRows(
  title: string,
  rows: Array<{ companyName: string; jobCount: number }>,
): void {
  console.log(`${title}:`);
  if (!rows.length) {
    console.log("  (no companies with jobs)");
    console.log("");
    return;
  }
  rows.forEach((row, idx) => {
    console.log(`${idx + 1}. ${row.companyName} - ${row.jobCount} jobs`);
  });
  console.log("");
}

async function main(): Promise<void> {
  loadRootEnv();
  const snapshot = await buildMetricsSnapshot(prisma);

  console.log("");
  console.log("================= SYSTEM METRICS =================");
  console.log("");

  console.log("Companies:");
  console.log(`* Total: ${snapshot.companies.totalCompanies}`);
  console.log(
    `* With Domain: ${snapshot.companies.companiesWithDomain} (${formatPct(snapshot.effectiveness.pctCompaniesWithDomain)})`,
  );
  console.log(
    `* With ATS: ${snapshot.companies.companiesWithATS} (${formatPct(snapshot.effectiveness.pctCompaniesWithATS)})`,
  );
  console.log(
    `* Ready: ${snapshot.companies.companiesReady} (${formatPct(snapshot.effectiveness.pctCompaniesReady)})`,
  );
  console.log(`* Enriching: ${snapshot.companies.companiesEnriching}`);
  console.log(`* Raw: ${snapshot.companies.companiesRaw}`);
  console.log(`* Exhausted: ${snapshot.companies.companiesExhausted}`);
  console.log(`* Created from jobs: ${snapshot.companies.companiesCreatedFromJobs}`);
  console.log(`* Created from dataset: ${snapshot.companies.companiesCreatedFromDataset}`);
  console.log("");

  console.log("Jobs:");
  console.log(`* Total: ${snapshot.jobs.totalJobs}`);
  console.log(`* Canonical: ${snapshot.jobs.totalCanonicalJobs}`);
  console.log(`* Duplicates: ${snapshot.jobs.totalDuplicateJobs}`);
  console.log("");

  console.log("Job Density:");
  console.log(`* Avg jobs/company: ${snapshot.density.avgJobsPerCompany}`);
  console.log(`* Median jobs/company: ${snapshot.density.medianJobsPerCompany}`);
  console.log("");

  printDensityRows("Top Companies", snapshot.topCompaniesByJobs);
  printDensityRows("Bottom Companies", snapshot.bottomCompaniesByJobs);

  console.log(`Generated at: ${snapshot.generatedAt}`);
  console.log("==================================================");
  console.log("");
}

void main()
  .catch(async (err) => {
    logger.error({ err, event: "metrics_snapshot_failed" }, "metrics_snapshot_failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
