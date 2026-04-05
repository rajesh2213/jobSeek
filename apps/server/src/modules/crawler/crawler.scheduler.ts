import { loadRootEnv } from "../../infrastructure/env/loadEnv.js";
import { prisma } from "../../infrastructure/db/prisma.js";
import { logger } from "../../utils/logger.js";
import { assertWorkerProcessEnv } from "../../infrastructure/env/validateWorkerEnv.js";
import { registerSchedulerShutdown } from "../../utils/schedulerShutdown.js";
import { createCompanyRepository } from "../company/company.repository.js";
import { CompanyService } from "../company/company.service.js";
import { createJobRepository } from "../job/job.repository.js";
import { getJobQueue, closeJobQueue } from "../../queues/job.queue.js";
import { CrawlerService } from "./crawler.service.js";

const TEN_MINUTES_MS = 10 * 60 * 1000;

async function runOnce(): Promise<void> {
  const jobQueue = getJobQueue();
  const companyRepository = createCompanyRepository(prisma);
  const companyService = new CompanyService(
    companyRepository,
    createJobRepository(prisma),
  );

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
  assertWorkerProcessEnv();

  logger.info({ event: "crawl_scheduler_start" }, "Crawler scheduler starting");

  try {
    await runOnce();
  } catch (err) {
    logger.error(err, "Crawler scheduler initial run failed");
  }

  const interval = setInterval(() => {
    void runOnce().catch((err) => {
      logger.error({ event: "crawl_scheduler_run_failed", err }, "Crawler scheduler run failed");
    });
  }, TEN_MINUTES_MS);

  registerSchedulerShutdown({
    intervalIds: [interval],
    closeQueues: [closeJobQueue],
    prismaDisconnect: () => prisma.$disconnect(),
  });
}

void main().catch((err) => {
  logger.error({ event: "crawl_scheduler_boot_failed", err }, "crawl_scheduler_boot_failed");
  process.exitCode = 1;
});

