import type { JobQueue } from "../../queues/job.queue.js";
import type { CompanyService } from "../company/company.service.js";
import type {
  CrawlCompanyJobsPayload,
} from "./crawler.types.js";
import {
  CRAWL_COMPANY_JOBS,
} from "./crawler.types.js";
import { logger } from "../../utils/logger.js";
import {
  CRAWLABLE_ATS_TYPES,
  isSupportedAtsType,
  type AtsType,
} from "../ats/ats.interface.js";

const CRAWL_COOLDOWN_MS = 5 * 60 * 1000;
const SCHEDULER_CHUNK_SIZE = 100;
const MAX_COMPANIES_PER_RUN_PER_ATS = 500;

export interface SchedulerRunStats {
  companiesScanned: number;
  jobsEnqueued: number;
  skippedDueToRecentCrawl: number;
}

export class CrawlerService {
  constructor(
    private readonly companyService: CompanyService,
    private readonly jobQueue: JobQueue,
  ) {}

  async enqueueGreenhouseCompanyCrawls(
    now = new Date(),
  ): Promise<SchedulerRunStats> {
    const companiesByAts = await Promise.all(
      CRAWLABLE_ATS_TYPES.map((atsType) =>
        this.companyService
          .listCrawlableByAtsType(atsType)
          .then((companies) => companies.slice(0, MAX_COMPANIES_PER_RUN_PER_ATS)),
      ),
    );
    const companies = companiesByAts.flat();

    const stats: SchedulerRunStats = {
      companiesScanned: companies.length,
      jobsEnqueued: 0,
      skippedDueToRecentCrawl: 0,
    };

    for (let i = 0; i < companies.length; i += SCHEDULER_CHUNK_SIZE) {
      const chunk = companies.slice(i, i + SCHEDULER_CHUNK_SIZE);
      for (const company of chunk) {
        if (company.lastCrawledAt) {
          const ageMs = now.getTime() - company.lastCrawledAt.getTime();
          if (ageMs < CRAWL_COOLDOWN_MS) {
            stats.skippedDueToRecentCrawl += 1;
            continue;
          }
        }

        const boardToken = company.atsBoardToken;
        if (!boardToken) {
          logger.warn(
            {
              event: "crawl_enqueue_skip",
              companyId: company.id,
              companyName: company.name,
            },
            "Skipping Greenhouse company without atsBoardToken",
          );
          continue;
        }

        const payload: CrawlCompanyJobsPayload = {
          companyId: company.id,
          companyName: company.name,
          atsType: isSupportedAtsType(company.atsType ?? "")
            ? (company.atsType as AtsType)
            : undefined,
          atsBoardToken: boardToken,
          greenhouseBoardToken: boardToken,
        };

        const jobId = `crawl-${company.id}`;
        try {
          await this.jobQueue.add(CRAWL_COMPANY_JOBS, payload, { jobId });
          await this.companyService.markCrawled(company.id, now);
          stats.jobsEnqueued += 1;
        } catch (err) {
          if (
            err instanceof Error &&
            err.message.toLowerCase().includes("job") &&
            err.message.toLowerCase().includes("exists") &&
            err.message.toLowerCase().includes(jobId.toLowerCase())
          ) {
            logger.debug(
              {
                event: "crawl_enqueue_duplicate_ignored",
                companyId: company.id,
                jobId,
              },
              "Duplicate crawl job ignored",
            );
            continue;
          }
          throw err;
        }
      }
    }
    return stats;
  }
}

