import { Worker } from "bullmq";
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { logger } from "../utils/logger.js";
import { getJobQueue, getRedisConnection, JOB_QUEUE_NAME } from "../queues/job.queue.js";
import { CompanyService } from "../modules/company/company.service.js";
import { createCompanyRepository } from "../modules/company/company.repository.js";
import { createJobRepository } from "../modules/job/job.repository.js";
import { JobService } from "../modules/job/job.service.js";
import { getAtsCrawler } from "../modules/ats/ats.factory.js";
import {
  CRAWL_COMPANY_JOBS,
  PROCESS_JOB,
  type CrawlCompanyJobsPayload,
  type NormalizedJob,
} from "../modules/crawler/crawler.types.js";
import { isSupportedAtsType, type AtsType } from "../modules/ats/ats.interface.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomIntInclusive(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function throttleApiCall(): Promise<void> {
  const delay = randomIntInclusive(100, 300);
  await sleep(delay);
}

type CrawlErrorType = "timeout" | "network" | "parse" | "unknown";

function classifyCrawlError(err: unknown): CrawlErrorType {
  if (err instanceof SyntaxError) return "parse";
  if (err instanceof TypeError) return "network";
  if (err instanceof Error) {
    const message = err.message.toLowerCase();
    if (
      err.name === "AbortError" ||
      err.name === "TimeoutError" ||
      message.includes("timed out") ||
      message.includes("timeout")
    ) {
      return "timeout";
    }
    if (message.includes("unexpected") && message.includes("response shape")) {
      return "parse";
    }
  }
  return "unknown";
}

function validateCrawlCompanyJobsPayload(
  data: unknown,
): CrawlCompanyJobsPayload | null {
  if (!isRecord(data)) return null;
  const companyId = data.companyId;
  const companyName = data.companyName;
  const greenhouseBoardToken = data.greenhouseBoardToken;
  const atsType = data.atsType;
  const atsBoardToken = data.atsBoardToken;
  if (
    !(companyId === undefined || typeof companyId === "string") ||
    typeof companyName !== "string" ||
    typeof greenhouseBoardToken !== "string" ||
    !(atsType === undefined || typeof atsType === "string") ||
    !(atsBoardToken === undefined || typeof atsBoardToken === "string")
  ) {
    return null;
  }
  const normalizedAtsType =
    typeof atsType === "string" && isSupportedAtsType(atsType)
      ? atsType
      : undefined;
  return {
    companyId,
    companyName,
    greenhouseBoardToken,
    atsType: normalizedAtsType,
    atsBoardToken,
  };
}

function validateNormalizedJob(data: unknown): NormalizedJob | null {
  if (!isRecord(data)) return null;
  const title = data.title;
  const sourceUrl = data.sourceUrl;
  const companyId = data.companyId;
  const source = data.source;
  const isRemote = data.isRemote;
  if (typeof title !== "string") return null;
  if (typeof sourceUrl !== "string") return null;
  if (typeof companyId !== "string") return null;
  if (!isSupportedAtsType(String(source))) return null;
  if (typeof isRemote !== "boolean") return null;

  const description = typeof data.description === "string" ? data.description : undefined;
  const location = typeof data.location === "string" ? data.location : undefined;
  let postedAt: Date | undefined;
  if (data.postedAt instanceof Date) {
    postedAt = data.postedAt;
  } else if (typeof data.postedAt === "string") {
    const d = new Date(data.postedAt);
    postedAt = Number.isNaN(d.getTime()) ? undefined : d;
  }

  return {
    title,
    description,
    location,
    isRemote,
    source: source as AtsType,
    sourceUrl,
    postedAt,
    companyId,
  };
}

interface CrawlSummaryCounters {
  jobsFetched: number;
  jobsInserted: number;
  jobsUpdated: number;
  failures: number;
}

async function start(): Promise<void> {
  loadRootEnv();

  const companyService = new CompanyService(
    createCompanyRepository(prisma),
  );
  const jobService = new JobService(createJobRepository(prisma));
  const queue = getJobQueue();
  const crawlCounters = new Map<string, CrawlSummaryCounters>();

  const worker = new Worker(
    JOB_QUEUE_NAME,
    async (bullJob) => {
      if (bullJob.name === CRAWL_COMPANY_JOBS) {
        const payload = validateCrawlCompanyJobsPayload(bullJob.data);
        if (!payload) throw new Error("Invalid crawl-company-jobs payload");

        const {
          companyId: companyIdFromPayload,
          companyName,
          greenhouseBoardToken,
          atsType: atsTypeFromPayload,
          atsBoardToken: atsBoardTokenFromPayload,
        } = payload;

        try {
          const company =
            companyIdFromPayload
              ? await companyService.findById(companyIdFromPayload)
              : await companyService.findByAtsBoardToken(
                  atsBoardTokenFromPayload ?? greenhouseBoardToken,
                );
          if (!company) {
            logger.warn(
              {
                event: "crawl_company_not_found",
                companyName,
                atsType: atsTypeFromPayload ?? "greenhouse",
              },
              "Company not found for ATS token; skipping crawl",
            );
            return;
          }
          const resolvedCompanyId = company.id;
          const resolvedAtsType =
            company.atsType ?? atsTypeFromPayload ?? "greenhouse";
          const resolvedToken =
            company.atsBoardToken ??
            atsBoardTokenFromPayload ??
            greenhouseBoardToken;
          if (!isSupportedAtsType(resolvedAtsType)) {
            throw new Error(
              `Unsupported ATS type on company ${resolvedCompanyId}: ${resolvedAtsType}`,
            );
          }
          const crawler = getAtsCrawler(resolvedAtsType);

          logger.info(
            {
              event: "crawl_start",
              companyId: resolvedCompanyId,
              companyName,
              atsType: resolvedAtsType,
            },
            "crawl started",
          );

          await throttleApiCall();
          const fetchStart = Date.now();
          const rawJobs = await crawler.fetchJobs(resolvedToken);
          const fetchDurationMs = Date.now() - fetchStart;
          logger.info(
            {
              event: "ats_fetch_latency",
              atsType: resolvedAtsType,
              companyId: resolvedCompanyId,
              duration_ms: fetchDurationMs,
            },
            "ATS fetch latency",
          );
          const normalizedJobs = crawler.parseJobs(rawJobs, resolvedCompanyId);

          logger.info(
            {
              event: "jobs_parsed",
              companyId: resolvedCompanyId,
              count: normalizedJobs.length,
              atsType: resolvedAtsType,
            },
            "Parsed ATS job list",
          );

          const sourceUrls = normalizedJobs.map((job) => job.sourceUrl);
          const jobsUpdated = await jobService.touchLastSeenBySourceUrls(
            sourceUrls,
            new Date(),
          );

          let enqueueFailures = 0;
          for (const normalizedJob of normalizedJobs) {
            try {
              await queue.add(PROCESS_JOB, normalizedJob);
            } catch (err) {
              enqueueFailures += 1;
              logger.error(
                {
                  event: "process_job_enqueue_failed",
                  companyId: resolvedCompanyId,
                  atsType: resolvedAtsType,
                  sourceUrl: normalizedJob.sourceUrl,
                  err,
                },
                "Failed to enqueue process-job",
              );
            }
          }

          const jobsFetched = normalizedJobs.length;
          if (jobsFetched === 0) {
            logger.info(
              {
                event: "crawl_summary",
                companyId: resolvedCompanyId,
                atsType: resolvedAtsType,
                jobs_fetched: 0,
                jobs_inserted: 0,
                jobs_updated: jobsUpdated,
                failures: enqueueFailures,
              },
              "Company crawl completed",
            );
            return;
          }

          crawlCounters.set(resolvedCompanyId, {
            jobsFetched,
            jobsInserted: 0,
            jobsUpdated,
            failures: enqueueFailures,
          });
        } catch (err) {
          const errorType = classifyCrawlError(err);
          logger.error(
            {
              event: "crawl_company_failed",
              companyId: companyIdFromPayload,
              companyName,
              atsType: atsTypeFromPayload ?? "greenhouse",
              errorType,
              err,
            },
            "Per-company crawl failed; skipping",
          );
          return;
        }
        return;
      }

      if (bullJob.name === PROCESS_JOB) {
        const payload = validateNormalizedJob(bullJob.data);
        if (!payload) throw new Error("Invalid process-job payload");

        const result = await jobService.createNormalized(payload);
        const counters = crawlCounters.get(payload.companyId);
        if (result.created) {
          if (counters) counters.jobsInserted += 1;
          logger.info(
            {
              event: "job_inserted",
              jobTitle: payload.title,
              sourceUrl: payload.sourceUrl,
              companyId: payload.companyId,
              source: payload.source,
            },
            "Job processed and stored",
          );
        } else {
          logger.debug(
            {
              event: "job_already_seen",
              jobTitle: payload.title,
              sourceUrl: payload.sourceUrl,
              companyId: payload.companyId,
              source: payload.source,
            },
            "Existing job already accounted for in batch seen update",
          );
        }

        if (counters) {
          const processed =
            counters.jobsInserted + counters.jobsUpdated + counters.failures;
          if (processed >= counters.jobsFetched) {
            logger.info(
              {
                event: "crawl_summary",
                companyId: payload.companyId,
                atsType: payload.source,
                jobs_fetched: counters.jobsFetched,
                jobs_inserted: counters.jobsInserted,
                jobs_updated: counters.jobsUpdated,
                failures: counters.failures,
              },
              "Company crawl completed",
            );
            crawlCounters.delete(payload.companyId);
          }
        }
        return;
      }

      throw new Error(`Unknown job name: ${bullJob.name}`);
    },
    {
      connection: getRedisConnection(),
      concurrency: 5,
    },
  );

  worker.on("failed", (job, err) => {
    if (job?.name === PROCESS_JOB) {
      const payload = validateNormalizedJob(job.data);
      if (payload) {
        const counters = crawlCounters.get(payload.companyId);
        const maxAttempts =
          typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
        const isTerminalFailure = job.attemptsMade >= maxAttempts;
        if (counters && isTerminalFailure) {
          counters.failures += 1;
          const processed =
            counters.jobsInserted + counters.jobsUpdated + counters.failures;
          if (processed >= counters.jobsFetched) {
            logger.info(
              {
                event: "crawl_summary",
                companyId: payload.companyId,
                atsType: payload.source,
                jobs_fetched: counters.jobsFetched,
                jobs_inserted: counters.jobsInserted,
                jobs_updated: counters.jobsUpdated,
                failures: counters.failures,
              },
              "Company crawl completed",
            );
            crawlCounters.delete(payload.companyId);
          }
        }
      }
    }

    logger.error(
      {
        event: "worker_job_failed",
        jobId: job?.id,
        name: job?.name,
        err,
      },
      "Worker job failed",
    );
  });

  worker.on("completed", (job) => {
    logger.debug(
      { event: "worker_job_completed", jobId: job.id, name: job.name },
      "Worker job completed",
    );
  });

  process.on("SIGINT", async () => {
    logger.info("Shutting down worker...");
    await worker.close();
    await queue.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}

void start();

