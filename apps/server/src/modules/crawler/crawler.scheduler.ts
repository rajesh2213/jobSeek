import { loadRootEnv } from "../../infrastructure/env/loadEnv.js";
import { prisma } from "../../infrastructure/db/prisma.js";
import { logger } from "../../utils/logger.js";
import { createCompanyRepository } from "../company/company.repository.js";
import { CompanyService } from "../company/company.service.js";
import { getJobQueue } from "../../queues/job.queue.js";
import { CrawlerService } from "./crawler.service.js";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

async function runOnce(): Promise<void> {
  const jobQueue = getJobQueue();
  const companyRepository = createCompanyRepository(prisma);
  const companyService = new CompanyService(companyRepository);

  const crawlerService = new CrawlerService(companyService, jobQueue);

  const stats = await crawlerService.enqueueGreenhouseCompanyCrawls();
  const companiesProcessed =
    stats.companiesScanned - stats.skippedDueToRecentCrawl;
  const jobsPerMinute = stats.jobsEnqueued / 5;
  logger.info(
    {
      event: "scheduler_run",
      companies_scanned: stats.companiesScanned,
      jobs_enqueued: stats.jobsEnqueued,
      skipped_due_to_recent_crawl: stats.skippedDueToRecentCrawl,
    },
    "Scheduler run completed",
  );
  logger.info(
    {
      event: "ingestion_rate",
      jobs_per_minute: Number(jobsPerMinute.toFixed(2)),
      companies_processed: companiesProcessed,
    },
    "Scheduler ingestion rate",
  );
}

async function main(): Promise<void> {
  loadRootEnv();

  logger.info({ event: "crawl_scheduler_start" }, "Crawler scheduler starting");

  try {
    await runOnce();
  } catch (err) {
    logger.error(err, "Crawler scheduler initial run failed");
  }

  setInterval(() => {
    void runOnce().catch((err) => {
      logger.error({ event: "crawl_scheduler_run_failed", err }, "Crawler scheduler run failed");
    });
  }, FIVE_MINUTES_MS);
}

void main();

