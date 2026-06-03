import { Worker } from "bullmq";
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { logger } from "../utils/logger.js";
import { createCompanyRepository } from "../modules/company/company.repository.js";
import { CompanyService } from "../modules/company/company.service.js";
import { createJobRepository } from "../modules/job/job.repository.js";
import { DiscoveryService } from "../modules/discovery/discovery.service.js";
import {
  DISCOVER_SOURCE,
  PROCESS_COMPANY,
  type DiscoverSourcePayload,
  type DiscoverySourceCompany,
  type ProcessCompanyPayload,
} from "../modules/discovery/discovery.types.js";
import { getDiscoveryQueue, DISCOVERY_QUEUE_NAME, closeDiscoveryQueue } from "../queues/discovery.queue.js";
import { getRedisConnection } from "../queues/job.queue.js";
import { assertWorkerProcessEnv } from "../infrastructure/env/validateWorkerEnv.js";
import { registerWorkerShutdown } from "../utils/workerShutdown.js";
import { startWorkerHeartbeat } from "../services/workerHeartbeat.service.js";
import { delay, normalizeDomain, randomIntInclusive } from "../utils/common.js";
import { slugifyCompanyName } from "../utils/slugify.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDiscoverSourcePayload(value: unknown): value is DiscoverSourcePayload {
  if (!isRecord(value)) return false;
  return (
    value.source === "yc" ||
    value.source === "github" ||
    value.source === "fortune500" ||
    value.source === "weworkremotely" ||
    value.source === "remoteok" ||
    value.source === "openclaw"
  );
}

function isProcessCompanyPayload(value: unknown): value is ProcessCompanyPayload {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === "string" &&
    (value.domain === undefined || typeof value.domain === "string") &&
    (
      value.source === "yc" ||
      value.source === "github" ||
      value.source === "fortune500" ||
      value.source === "weworkremotely" ||
      value.source === "remoteok" ||
      value.source === "openclaw"
    )
  );
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function dedupeCompanies(
  companies: DiscoverySourceCompany[],
): DiscoverySourceCompany[] {
  const seenNames = new Set<string>();
  const seenDomains = new Set<string>();
  const deduped: DiscoverySourceCompany[] = [];

  for (const company of companies) {
    const nameKey = normalizeName(company.name);
    const domainKey = normalizeDomain(company.domain);
    if (!nameKey) continue;
    if (seenNames.has(nameKey)) continue;
    if (domainKey && seenDomains.has(domainKey)) continue;

    seenNames.add(nameKey);
    if (domainKey) seenDomains.add(domainKey);
    deduped.push({
      name: company.name.trim(),
      domain: domainKey,
    });
  }

  return deduped;
}

async function throttleRequest(): Promise<void> {
  await delay(randomIntInclusive(100, 300));
}

async function start(): Promise<void> {
  loadRootEnv();
  assertWorkerProcessEnv();
  startWorkerHeartbeat("company-discovery");

  const companyService = new CompanyService(
    createCompanyRepository(prisma),
    createJobRepository(prisma),
  );
  const discoveryService = new DiscoveryService(companyService);
  const queue = getDiscoveryQueue();

  const worker = new Worker(
    DISCOVERY_QUEUE_NAME,
    async (job) => {
      if (job.name === DISCOVER_SOURCE) {
        if (!isDiscoverSourcePayload(job.data)) {
          throw new Error("Invalid discover-source payload");
        }

        const companies = await discoveryService.discoverSource(job.data.source);
        logger.info({ event: "companies_found", source: job.data.source, count: companies.length }, "Discovery source fetched companies");

        const dedupedCompanies = dedupeCompanies(companies);
        logger.info(
          {
            event: "source_deduplicated",
            source: job.data.source,
            before: companies.length,
            after: dedupedCompanies.length,
          },
          "Source companies deduplicated",
        );

        for (const company of dedupedCompanies) {
          const payload: ProcessCompanyPayload = {
            source: job.data.source,
            name: company.name,
            domain: company.domain,
          };
          const slug = slugifyCompanyName(company.name);
          const domainKey = normalizeDomain(company.domain) ?? "nodomain";
          await queue.add(PROCESS_COMPANY, payload, {
            jobId: `process-${payload.source}-${domainKey}-${slug}`.slice(0, 240),
          });
        }

        return;
      }

      if (job.name === PROCESS_COMPANY) {
        if (!isProcessCompanyPayload(job.data)) {
          throw new Error("Invalid process-company payload");
        }

        await throttleRequest();
        try {
          await discoveryService.processCompanyCandidate(job.data);
        } catch (err) {
          logger.error(
            {
              event: "discovery_company_failed",
              source: job.data.source,
              companyName: job.data.name,
              err,
            },
            "Discovery company processing failed",
          );
        }
        return;
      }

      throw new Error(`Unknown discovery job: ${job.name}`);
    },
    {
      connection: getRedisConnection(),
      concurrency: 3,
    },
  );

  worker.on("failed", (job, err) => {
    logger.error({ event: "discovery_worker_failed", jobId: job?.id, name: job?.name, err }, "Discovery worker job failed");
  });

  registerWorkerShutdown({
    worker,
    closeQueues: [closeDiscoveryQueue],
    prismaDisconnect: () => prisma.$disconnect(),
  });
}

void start().catch((err) => {
  logger.error({ event: "discovery_worker_boot_failed", err }, "discovery_worker_boot_failed");
  process.exitCode = 1;
});
