import { CompanyCrawlPriority } from "@prisma/client";
import type { Company } from "@prisma/client";
import type { JobQueue } from "../../queues/job.queue.js";
import type { CompanyService } from "../company/company.service.js";
import type { CrawlCompanyJobsPayload } from "./crawler.types.js";
import { CRAWL_COMPANY_JOBS } from "./crawler.types.js";
import { logger } from "../../utils/logger.js";
import {
  CRAWLABLE_ATS_TYPES,
  isSupportedAtsType,
  type AtsType,
} from "../ats/ats.interface.js";

const SCHEDULER_CHUNK_SIZE = 100;
const MAX_COMPANIES_PER_RUN_PER_ATS = 500;

const COOLDOWN_BY_PRIORITY_MS: Record<CompanyCrawlPriority, number> = {
  [CompanyCrawlPriority.high]: 5 * 60 * 1000,
  [CompanyCrawlPriority.medium]: 15 * 60 * 1000,
  [CompanyCrawlPriority.low]: 60 * 60 * 1000,
};

function effectiveSchedulerPriority(company: Pick<Company, "score" | "priority">): CompanyCrawlPriority {
  if (company.score === 0) return CompanyCrawlPriority.medium;
  return company.priority;
}

function shouldEnqueueForCycle(
  effectivePriority: CompanyCrawlPriority,
  schedulerCycle: number,
): boolean {
  if (effectivePriority === CompanyCrawlPriority.high) return true;
  if (effectivePriority === CompanyCrawlPriority.medium) return schedulerCycle % 3 === 0;
  return schedulerCycle % 10 === 0;
}

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
    schedulerCycle = 0,
  ): Promise<SchedulerRunStats> {
    const companiesByAts = await Promise.all(
      CRAWLABLE_ATS_TYPES.map((atsType) =>
        this.companyService
          .listCrawlableByAtsType(atsType)
          .then((companies) => companies.slice(0, MAX_COMPANIES_PER_RUN_PER_ATS)),
      ),
    );
    const companies = companiesByAts
      .flat()
      .sort((a, b) => {
        const ds = b.score - a.score;
        if (ds !== 0) return ds;
        return a.name.localeCompare(b.name);
      });

    const stats: SchedulerRunStats = {
      companiesScanned: companies.length,
      jobsEnqueued: 0,
      skippedDueToRecentCrawl: 0,
    };

    for (let i = 0; i < companies.length; i += SCHEDULER_CHUNK_SIZE) {
      const chunk = companies.slice(i, i + SCHEDULER_CHUNK_SIZE);
      for (const company of chunk) {
        const eff = effectiveSchedulerPriority(company);
        if (!shouldEnqueueForCycle(eff, schedulerCycle)) {
          continue;
        }

        const cooldownMs = COOLDOWN_BY_PRIORITY_MS[eff];
        if (company.lastAttemptAt) {
          const ageMs = now.getTime() - company.lastAttemptAt.getTime();
          if (ageMs < cooldownMs) {
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

