import { loadRootEnv } from "../../infrastructure/env/loadEnv.js";
import { prisma } from "../../infrastructure/db/prisma.js";
import { logger } from "../../utils/logger.js";
import { assertWorkerProcessEnv } from "../../infrastructure/env/validateWorkerEnv.js";
import { registerSchedulerShutdown } from "../../utils/schedulerShutdown.js";
import { getDiscoveryQueue, closeDiscoveryQueue } from "../../queues/discovery.queue.js";
import {
  ENRICH_COMPANY_JOB,
  ENRICH_PRIORITY_BACKLOG,
  getEnrichCompanyQueue,
  closeEnrichCompanyQueue,
} from "../../queues/enrich-company.queue.js";
import {
  DISCOVER_SOURCE,
  type DiscoverySourceType,
} from "./discovery.types.js";
import { discoverySources } from "./discovery.service.js";
import { createCompanyRepository } from "../company/company.repository.js";
import { CompanyService } from "../company/company.service.js";
import { createJobRepository } from "../job/job.repository.js";
import { getCompanyDiscoveryMetricsWithDb } from "../../services/companyDiscoveryMetrics.service.js";

const TEN_MINUTES_MS = 10 * 60 * 1000;
const SOURCES: DiscoverySourceType[] = discoverySources.map((s) => s.source);
const ENRICH_BACKLOG_BATCH = 30;

async function runOnce(): Promise<void> {
  const queue = getDiscoveryQueue();
  const enrichQueue = getEnrichCompanyQueue();

  logger.info({ event: "discovery_start" }, "Company discovery scheduler started");

  let jobs = 0;
  for (const source of SOURCES) {
    await queue.add(DISCOVER_SOURCE, { source }, { jobId: `discover-${source}` });
    jobs += 1;
  }

  const companyRepo = createCompanyRepository(prisma);
  const companyService = new CompanyService(companyRepo, createJobRepository(prisma));
  const backlog = await companyService.listCompaniesForEnrichmentBacklog(ENRICH_BACKLOG_BATCH);
  let enrichEnqueued = 0;
  for (const c of backlog) {
    try {
      await enrichQueue.add(
        ENRICH_COMPANY_JOB,
        { companyId: c.id, companyName: c.name },
        {
          jobId: `enrich-${c.id}`,
          priority: ENRICH_PRIORITY_BACKLOG,
          attempts: 2,
          backoff: { type: "exponential", delay: 8000 },
        },
      );
      enrichEnqueued += 1;
    } catch {
      /* duplicate job id — expected */
    }
  }

  const metrics = await getCompanyDiscoveryMetricsWithDb(prisma);
  logger.info(
    {
      event: "discovery_summary",
      sources: SOURCES.length,
      jobs_enqueued: jobs,
      enrich_backlog_enqueued: enrichEnqueued,
      metrics: {
        companies_created_from_jobs: metrics.companiesCreatedFromJobs,
        enrichment_success_rate: metrics.enrichmentSuccessRate,
        partial_enrichment_count: metrics.partialEnrichmentCount,
        ready_companies: metrics.readyCompanies,
        total_companies: metrics.totalCompanies,
        jobs_per_company: metrics.jobsPerCompany,
      },
    },
    "Discovery scheduler run completed",
  );
}

async function main(): Promise<void> {
  loadRootEnv();
  assertWorkerProcessEnv();
  await runOnce();
  const interval = setInterval(() => {
    void runOnce().catch((err) => {
      logger.error({ event: "discovery_scheduler_failed", err }, "Discovery scheduler run failed");
    });
  }, TEN_MINUTES_MS);

  registerSchedulerShutdown({
    intervalIds: [interval],
    closeQueues: [closeDiscoveryQueue, closeEnrichCompanyQueue],
    prismaDisconnect: () => prisma.$disconnect(),
  });
}

void main().catch((err) => {
  logger.error({ event: "discovery_scheduler_boot_failed", err }, "discovery_scheduler_boot_failed");
  process.exitCode = 1;
});
