import { logger } from "../../../utils/logger.js";
import { delay, randomIntInclusive } from "../../../utils/common.js";
import { asyncPool } from "../../../utils/asyncPool.js";
import type { AtsCrawler } from "../ats.interface.js";
import { throttleByAts } from "../ats.interface.js";
import { enrichWorkdayRawJobWithDetail } from "./workday.detail.js";
import { parseWorkdayJobs, resolveWorkdayListingUrl } from "./workday.parser.js";
import type {
  WorkdayJobsResponse,
  WorkdayRawJob,
  WorkdayToken,
} from "./workday.types.js";

const PAGE_LIMIT = 20;
const SITE_FALLBACKS = ["Careers", "External", "Global"] as const;
const WORKDAY_DETAIL_CONCURRENCY = 5;

/** Max listing pages per Workday token attempt (20 jobs/page). Stops runaway pagination if the API never returns a short page. */
function workdayListingMaxPages(): number {
  const n = Number(process.env.WORKDAY_LISTING_MAX_PAGES ?? "2000");
  if (!Number.isFinite(n)) return 2000;
  return Math.max(50, Math.min(50_000, Math.floor(n)));
}

/**
 * Wall-clock cap for Workday listing fetch (per token attempt + overall host/site sweep).
 * Prevents a single board from monopolizing the ATS worker for hours when pagination misbehaves.
 */
function workdayFetchMaxMs(): number {
  const n = Number(process.env.WORKDAY_FETCH_MAX_MS ?? "600000");
  if (!Number.isFinite(n)) return 600_000;
  return Math.max(60_000, Math.min(3_600_000, Math.floor(n)));
}

async function enrichWorkdayResults(jobs: WorkdayRawJob[]): Promise<WorkdayRawJob[]> {
  if (jobs.length === 0) return jobs;
  return asyncPool(jobs, WORKDAY_DETAIL_CONCURRENCY, (raw) => enrichWorkdayRawJobWithDetail(raw));
}

function parseTokenFromUrl(value: string): WorkdayToken | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (!host.includes("myworkdayjobs.com")) return null;
    const tenant = host.split(".")[0];
    if (!tenant) return null;
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts.length === 0) return null;
    const firstSeg = pathParts[0]!.toLowerCase();
    if (firstSeg === "job" && pathParts.length >= 3) {
      return { host, tenant, site: "Careers" };
    }
    const site = pathParts[pathParts.length - 1];
    if (!site) return null;
    return { host, tenant, site };
  } catch {
    return null;
  }
}

function parseToken(token: string): WorkdayToken | null {
  const trimmed = token.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as Partial<WorkdayToken>;
    if (
      typeof parsed.host === "string" &&
      typeof parsed.tenant === "string" &&
      typeof parsed.site === "string"
    ) {
      return {
        host: parsed.host.trim().toLowerCase(),
        tenant: parsed.tenant.trim(),
        site: parsed.site.trim(),
      };
    }
  } catch {
    /* not JSON */
  }

  const asUrl = parseTokenFromUrl(trimmed);
  if (asUrl) return asUrl;

  const parts = trimmed.split("|").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 3) {
    const [host, tenant, site] = parts;
    if (host && tenant && site) {
      return { host: host.toLowerCase(), tenant, site };
    }
  }

  return null;
}

function isValidToken(token: WorkdayToken | null): token is WorkdayToken {
  if (!token) return false;
  return Boolean(token.host?.trim() && token.tenant?.trim() && token.site?.trim());
}

function withUniqueSites(initialSite: string): string[] {
  const candidates = [initialSite, ...SITE_FALLBACKS];
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const site of candidates) {
    const key = site.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(site.trim());
  }
  return unique;
}

function withHostFallbacks(host: string): string[] {
  const hosts = [host.toLowerCase()];
  const m = host.match(/^(.*)\.wd(\d+)\.(myworkdayjobs\.com)$/i);
  if (!m) return hosts;

  const prefix = m[1];
  const suffix = m[3];
  for (const variant of ["1", "3", "5"]) {
    const candidate = `${prefix}.wd${variant}.${suffix}`.toLowerCase();
    if (!hosts.includes(candidate)) hosts.push(candidate);
  }
  return hosts;
}

interface FetchAttemptResult {
  jobs: WorkdayRawJob[];
  pagesFetched: number;
  complete: boolean;
  reason?: string;
}

async function fetchJobsForToken(token: WorkdayToken): Promise<FetchAttemptResult> {
  const endpoint = `https://${token.host}/wday/cxs/${token.tenant}/${token.site}/jobs`;
  const jobs: WorkdayRawJob[] = [];
  let offset = 0;
  let pagesFetched = 0;
  const maxPages = workdayListingMaxPages();
  const maxMs = workdayFetchMaxMs();
  const tokenLoopStart = Date.now();

  while (true) {
    if (pagesFetched >= maxPages) {
      return {
        jobs,
        pagesFetched,
        complete: false,
        reason: "max_pages_exceeded",
      };
    }
    if (Date.now() - tokenLoopStart > maxMs) {
      return {
        jobs,
        pagesFetched,
        complete: false,
        reason: "max_duration_per_token_exceeded",
      };
    }
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ limit: PAGE_LIMIT, offset }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (err) {
      return {
        jobs,
        pagesFetched,
        complete: false,
        reason: err instanceof Error ? err.message : "network_error",
      };
    }

    if (!res.ok) {
      return {
        jobs,
        pagesFetched,
        complete: false,
        reason: `http_${res.status}`,
      };
    }

    let data: WorkdayJobsResponse;
    try {
      data = (await res.json()) as WorkdayJobsResponse;
    } catch (err) {
      return {
        jobs,
        pagesFetched,
        complete: false,
        reason: err instanceof Error ? err.message : "invalid_json",
      };
    }

    const page = Array.isArray(data.jobPostings) ? data.jobPostings : [];
    if (page.length === 0) {
      return { jobs, pagesFetched, complete: true };
    }

    pagesFetched += 1;
    jobs.push(...page.map((job) => ({ token, job })));
    if (page.length < PAGE_LIMIT) {
      return { jobs, pagesFetched, complete: true };
    }

    offset += PAGE_LIMIT;
    await delay(randomIntInclusive(400, 600));
  }
}

class WorkdayCrawlerImpl implements AtsCrawler<WorkdayRawJob> {
  readonly atsType = "workday" as const;

  async fetchJobs(token: string): Promise<WorkdayRawJob[]> {
    const startedAt = Date.now();
    await throttleByAts(this.atsType);
    const parsedToken = parseToken(token);

    logger.info(
      { event: "workday_fetch_start", companyId: null },
      "Workday fetch started",
    );

    if (!isValidToken(parsedToken)) {
      logger.warn(
        { event: "workday_fetch_failed", reason: "invalid_token", companyId: null },
        "Workday token invalid; skipping",
      );
      return [];
    }
    const hostCandidates = withHostFallbacks(parsedToken.host);
    const siteCandidates = withUniqueSites(parsedToken.site);
    const maxTotalMs = workdayFetchMaxMs();

    let bestJobs: WorkdayRawJob[] = [];
    let lastFailureReason = "unknown";

    outer: for (const host of hostCandidates) {
      for (const site of siteCandidates) {
        if (Date.now() - startedAt > maxTotalMs) {
          logger.warn(
            {
              event: "workday_fetch_total_time_cap",
              duration_ms: Date.now() - startedAt,
              max_ms: maxTotalMs,
              companyId: null,
            },
            "workday_fetch_total_time_cap",
          );
          break outer;
        }
        const tokenCandidate: WorkdayToken = {
          host,
          tenant: parsedToken.tenant,
          site,
        };
        const result = await fetchJobsForToken(tokenCandidate);

        if (result.jobs.length > 0 && !result.complete) {
          logger.warn(
            {
              event: "workday_fetch_partial",
              pages_fetched: result.pagesFetched,
              jobs_fetched: result.jobs.length,
              companyId: null,
              host,
              site,
            },
            "Workday fetch returned partial results",
          );
        }

        if (result.jobs.length > bestJobs.length) {
          bestJobs = result.jobs;
        }

        if (result.complete) {
          const deduped = new Map<string, WorkdayRawJob>();
          for (const raw of result.jobs) {
            const sourceUrl = resolveWorkdayListingUrl(raw.token.host, raw.job);
            if (!sourceUrl) {
              logger.warn(
                {
                  event: "invalid_job_url",
                  url: raw.job.externalPath ?? raw.job.jobPostingUrl ?? "(empty)",
                  company: raw.token.tenant,
                },
                "invalid_job_url",
              );
              continue;
            }
            if (!deduped.has(sourceUrl)) {
              deduped.set(sourceUrl, raw);
            }
          }
          const finalJobs = Array.from(deduped.values());
          logger.info(
            {
              event: "workday_fetch_latency",
              duration_ms: Date.now() - startedAt,
              companyId: null,
            },
            "Workday fetch latency",
          );
          logger.info(
            { event: "workday_fetch_success", jobs_fetched: finalJobs.length, companyId: null },
            "Workday fetch succeeded",
          );
          return enrichWorkdayResults(finalJobs);
        }

        lastFailureReason = result.reason ?? lastFailureReason;
      }
    }

    if (bestJobs.length > 0) {
      logger.warn(
        {
          event: "workday_fetch_partial",
          pages_fetched: null,
          jobs_fetched: bestJobs.length,
          companyId: null,
        },
        "Workday fetch kept best partial result",
      );
      const deduped = new Map<string, WorkdayRawJob>();
      for (const raw of bestJobs) {
        const sourceUrl = resolveWorkdayListingUrl(raw.token.host, raw.job);
        if (!sourceUrl) {
          logger.warn(
            {
              event: "invalid_job_url",
              url: raw.job.externalPath ?? raw.job.jobPostingUrl ?? "(empty)",
              company: raw.token.tenant,
            },
            "invalid_job_url",
          );
          continue;
        }
        if (!deduped.has(sourceUrl)) {
          deduped.set(sourceUrl, raw);
        }
      }
      const finalJobs = Array.from(deduped.values());
      logger.info(
        {
          event: "workday_fetch_latency",
          duration_ms: Date.now() - startedAt,
          companyId: null,
        },
        "Workday fetch latency",
      );
      logger.info(
        { event: "workday_fetch_success", jobs_fetched: finalJobs.length, companyId: null },
        "Workday fetch succeeded with partial coverage",
      );
      return enrichWorkdayResults(finalJobs);
    }

    logger.info(
      {
        event: "workday_fetch_latency",
        duration_ms: Date.now() - startedAt,
        companyId: null,
      },
      "Workday fetch latency",
    );
    logger.warn(
      {
        event: "workday_fetch_failed",
        reason: lastFailureReason,
        companyId: null,
      },
      "Workday fetch failed; skipping",
    );
    return [];
  }

  parseJobs(rawJobs: WorkdayRawJob[], companyId: string) {
    return parseWorkdayJobs(rawJobs, companyId);
  }
}

export const workdayCrawler = new WorkdayCrawlerImpl();

