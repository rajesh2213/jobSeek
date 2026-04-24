import { loadRootEnv } from "../../infrastructure/env/loadEnv.js";
import { prisma } from "../../infrastructure/db/prisma.js";
import { logger } from "../../utils/logger.js";
import { assertWorkerProcessEnv } from "../../infrastructure/env/validateWorkerEnv.js";
import { registerSchedulerShutdown } from "../../utils/schedulerShutdown.js";
import { createCompanyRepository } from "../company/company.repository.js";
import { CompanyService } from "../company/company.service.js";
import { createJobRepository } from "../job/job.repository.js";
import { getJobQueue, closeJobQueue } from "../../queues/job.queue.js";
import { logCompanyPriorityDistribution } from "../../services/companyScore.service.js";
import { CrawlerService } from "./crawler.service.js";

const TEN_MINUTES_MS = 10 * 60 * 1000;

async function runOnce(schedulerCycle: number): Promise<void> {
  const jobQueue = getJobQueue();
  const companyRepository = createCompanyRepository(prisma);
  const companyService = new CompanyService(
    companyRepository,
    createJobRepository(prisma),
  );

  const crawlerService = new CrawlerService(companyService, jobQueue);

  await logCompanyPriorityDistribution(prisma);

  const stats = await crawlerService.enqueueGreenhouseCompanyCrawls(new Date(), schedulerCycle);
  const companiesProcessed = stats.companiesScanned - stats.skippedDueToRecentCrawl;
  const jobsPerMinute = stats.jobsEnqueued / 5;
  logger.info(
    {
      event: "scheduler_run",
      companies_scanned: stats.companiesScanned,
      jobs_enqueued: stats.jobsEnqueued,
      skipped_due_to_recent_crawl: stats.skippedDueToRecentCrawl,
      jobs_per_minute: Number(jobsPerMinute.toFixed(2)),
      companies_processed: companiesProcessed,
    },
    "Scheduler run completed",
  );
}

async function main(): Promise<void> {
  loadRootEnv();
  assertWorkerProcessEnv();

  logger.info({ event: "crawl_scheduler_start" }, "Crawler scheduler starting");

  let schedulerCycle = 0;
  try {
    await runOnce(schedulerCycle);
  } catch (err) {
    logger.error(err, "Crawler scheduler initial run failed");
  }

  const interval = setInterval(() => {
    schedulerCycle += 1;
    void runOnce(schedulerCycle).catch((err) => {
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

