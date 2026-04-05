import type { AtsType } from "./ats.interface.js";
import { getAtsCrawler } from "./ats.factory.js";
import type { AtsEndpoint } from "@prisma/client";
import type { NormalizedJob } from "../crawler/crawler.types.js";
import { parseWorkdaySlug } from "../atsDiscovery/atsUrlParser.js";
import { logger } from "../../utils/logger.js";

export type AtsEndpointLike = Pick<
  AtsEndpoint,
  "id" | "type" | "slug" | "baseUrl" | "metadata" | "companyId" | "companyName"
>;

export interface AtsCrawlerStandard {
  fetchJobs(endpoint: AtsEndpointLike): Promise<NormalizedJob[]>;
}

/** Uses `metadata.crawlToken`, or for Workday derives JSON token from `slug` when metadata is absent. */
function readCrawlToken(endpoint: AtsEndpointLike): string | null {
  if (!endpoint.metadata || typeof endpoint.metadata !== "object") return null;
  const meta = endpoint.metadata as Record<string, unknown>;
  const crawlToken = meta.crawlToken;
  if (typeof crawlToken === "string" && crawlToken.trim()) return crawlToken.trim();

  if (endpoint.type === "workday") {
    const w = parseWorkdaySlug(endpoint.slug);
    if (w) return JSON.stringify(w);
  }

  return null;
}

function normalizeParsedJob(job: NormalizedJob, endpoint: AtsEndpointLike): NormalizedJob {
  return {
    ...job,
    applyUrl: job.applyUrl ?? job.sourceUrl,
    description: job.description && job.description.trim().length > 0 ? job.description : undefined,
    companyName: endpoint.companyName ?? job.companyName,
  };
}

export function createAtsCrawlerStandard(atsType: AtsType): AtsCrawlerStandard {
  return {
    async fetchJobs(endpoint: AtsEndpointLike): Promise<NormalizedJob[]> {
      const token = readCrawlToken(endpoint);

      const endpointId = endpoint.id ?? null;
      const slug = endpoint.slug;

      let crawler;
      try {
        crawler = getAtsCrawler(atsType);
      } catch (err) {
        logger.info(
          {
            event: "ats_unsupported_type",
            type: atsType,
            slug,
            endpointId,
          },
          "ats_unsupported_type",
        );
        return [];
      }

      if (!token) {
        const error = new Error("Missing crawlToken");
        logger.error(
          {
            event: "ats_crawler_failed",
            endpointId,
            atsType,
            slug,
            token: null,
            errorKind: "parser_error",
            err: error,
          },
          "ats_crawler_failed",
        );
        throw error;
      }

      logger.info(
        {
          event: "ats_crawler_started",
          endpointId,
          atsType,
          slug,
          token,
        },
        "ats_crawler_started",
      );

      try {
        if (!endpoint.companyId) {
          const error = new Error("Missing endpoint.companyId for parsing");
          logger.error(
            {
              event: "ats_crawler_failed",
              endpointId,
              atsType,
              slug,
              token,
              errorKind: "parser_error",
              err: error,
            },
            "ats_crawler_failed",
          );
          throw error;
        }

        const rawJobs = await crawler.fetchJobs(token);
        logger.info(
          {
            event: "ats_jobs_fetched_count",
            endpointId,
            atsType,
            slug,
            token,
            jobCount: Array.isArray(rawJobs) ? rawJobs.length : 0,
          },
          "ats_jobs_fetched_count",
        );

        const parsed = crawler.parseJobs(rawJobs, endpoint.companyId);
        const normalized = parsed.map((j) => normalizeParsedJob(j, endpoint));

        logger.info(
          {
            event: "ats_crawler_completed",
            endpointId,
            atsType,
            slug,
            token,
            jobCount: normalized.length,
          },
          "ats_crawler_completed",
        );

        return normalized;
      } catch (err) {
        const errorKind =
          err instanceof Error && /parse/i.test(err.message) ? "parser_error" : "crawler_error";
        logger.error(
          {
            event: "ats_crawler_failed",
            endpointId,
            atsType,
            slug,
            token,
            errorKind,
            err,
          },
          "ats_crawler_failed",
        );
        throw err;
      }
    },
  };
}

