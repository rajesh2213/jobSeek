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
/** Shuffle only the leading slice of a sorted list (roughly top 20–30%) to reduce fixed ordering. */
const SHUFFLE_TOP_FRACTION = 0.3;

/**
 * Order crawl candidates: higher score, then less-recently **completed** activity, then job volume, then name.
 *
 * Recency uses `lastAttemptAt` when set (updated on successful/failed ingest completion in
 * `recordIngestionFinished`) — completion-oriented. Falls back to `lastCrawledAt` for legacy rows
 * where `lastAttemptAt` is still null.
 */
function compareCrawlSelection(a: Company, b: Company): number {
  if (b.score !== a.score) return b.score - a.score;

  const aLast = (a.lastAttemptAt ?? a.lastCrawledAt)?.getTime() ?? 0;
  const bLast = (b.lastAttemptAt ?? b.lastCrawledAt)?.getTime() ?? 0;
  if (aLast !== bLast) return aLast - bLast;

  const aJobs = a.canonicalJobsLast7d;
  const bJobs = b.canonicalJobsLast7d;
  if (aJobs !== bJobs) return aJobs - bJobs;

  return a.name.localeCompare(b.name);
}

function fisherYatesShuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = t;
  }
}

/**
 * Full sort, then lightly shuffle the top `SHUFFLE_TOP_FRACTION` of the list, then return.
 * Used for per-ATS cap and the global inter-ATS pass.
 */
function sortShuffleTopFraction(all: Company[]): Company[] {
  if (all.length === 0) return [];
  const sorted = [...all].sort(compareCrawlSelection);
  const rawTop = Math.floor(sorted.length * SHUFFLE_TOP_FRACTION);
  const topN = Math.min(sorted.length, Math.max(sorted.length > 0 ? 1 : 0, rawTop));
  if (topN === 0) return sorted;
  const head = sorted.slice(0, topN);
  const tail = sorted.slice(topN);
  fisherYatesShuffleInPlace(head);
  return [...head, ...tail];
}

function takeCrawlablePerAts(atsCompanies: Company[], max: number): Company[] {
  return sortShuffleTopFraction(atsCompanies).slice(0, max);
}

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
          .then((crawlable) => takeCrawlablePerAts(crawlable, MAX_COMPANIES_PER_RUN_PER_ATS)),
      ),
    );
    const companies = sortShuffleTopFraction(companiesByAts.flat());

    logger.info(
      {
        event: "company_selection_sample",
        selected: companies.slice(0, 10).map((c) => ({
          name: c.name,
          score: c.score,
          lastAttemptAt: c.lastAttemptAt,
          lastCrawledAt: c.lastCrawledAt,
          // Proxy for “job count” when selecting for exploration; schema has no aggregate jobCount.
          jobCount: c.canonicalJobsLast7d,
        })),
      },
      "company_selection_sample",
    );

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

        const enqueueMs = now.getTime();
        const payload: CrawlCompanyJobsPayload = {
          companyId: company.id,
          companyName: company.name,
          atsType: isSupportedAtsType(company.atsType ?? "")
            ? (company.atsType as AtsType)
            : undefined,
          atsBoardToken: boardToken,
          greenhouseBoardToken: boardToken,
          crawlEnqueuedAtMs: enqueueMs,
        };

        const jobId = `crawl-${company.id}`;
        try {
          await this.jobQueue.add(CRAWL_COMPANY_JOBS, payload, { jobId });
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

