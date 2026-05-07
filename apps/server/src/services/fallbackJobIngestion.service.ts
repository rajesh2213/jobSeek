import type { PrismaClient } from "@prisma/client";
import type { NormalizedJob } from "../modules/crawler/crawler.types.js";
import type { AtsType } from "../modules/ats/ats.interface.js";
import { extractCompanyDomain } from "../utils/jobFingerprint.js";
import { normalizeDomain } from "../utils/common.js";
import {
  canonicalCompanyNameKey,
  diceSimilarity,
  FUZZY_COMPANY_MATCH_MIN,
} from "../utils/companyNameCanonical.js";
import { logger } from "../utils/logger.js";
import type { JobService } from "../modules/job/job.service.js";
import { createJobRepository } from "../modules/job/job.repository.js";
import { enrichCanonicalJobParsedDescription } from "../modules/ai/jobDescriptionEnrichment.js";
import type { IngestJobsFromSourcePayload } from "../modules/crawler/crawler.types.js";
import {
  markRemoteOkFetchStart,
  markRemoteOkHttpError,
  markRemoteOkSuccess,
  throttleBeforeRemoteOkFetch,
  throttleBeforeWellfoundFetch,
} from "./fallbackIngestionLimits.js";
import {
  extractWellfoundListingsFromHtml,
  fetchWellfoundJobsHtml,
} from "../modules/discovery/extractors/wellfoundJobs.extractor.js";
import { computeJobContentHash } from "../utils/jobContentHash.js";
import {
  estimateJsonBytes,
  logUpdateReturnBytesEstimate,
  logUpdateReturnClassification,
  logUpdateReturnOptimized,
} from "../utils/dbPayloadDebug.js";

const REMOTEOK_API = "https://remoteok.com/api";
const MAX_REMOTEOK_JOBS_PER_COMPANY = 35;
const MAX_WELLFOUND_JOBS_PER_COMPANY = 35;
/** When we have no real hostname, fuzzy name match must be stricter. */
const FUZZY_NO_DOMAIN_MIN = 0.88;

interface RemoteOkRow {
  url?: string;
  id?: string;
  company?: string;
  company_logo?: string;
  position?: string;
  title?: string;
  description?: string;
  date?: string;
}

function isLikelyRemoteOkJobRow(x: unknown): x is RemoteOkRow {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.url === "string" && "company" in o;
}

function extractDomainFromLogoUrl(logo: string | undefined): string | null {
  if (!logo?.trim()) return null;
  const m = logo.match(/logo\.clearbit\.com\/([^/?&]+)/i);
  if (!m) return null;
  return m[1]!.toLowerCase().replace(/^www\./, "");
}

function normalizeHostExpect(d: string | null | undefined): string | null {
  if (!d?.trim()) return null;
  const t = d.trim().toLowerCase();
  if (t.startsWith("company:")) return null;
  return t.replace(/^www\./, "");
}

/**
 * Prefer Clearbit domain on RemoteOK row vs our company domain; else fuzzy name with threshold.
 */
function remoteOkRowMatches(
  row: RemoteOkRow,
  companyName: string,
  expectDomain: string | null,
): boolean {
  const label = String(row.company ?? "").trim();
  if (!label) return false;

  const logoDomain = extractDomainFromLogoUrl(row.company_logo);
  const want = normalizeHostExpect(expectDomain);

  if (want && logoDomain) {
    const a = normalizeDomain(logoDomain);
    const b = normalizeDomain(want);
    if (a && b && a === b) return true;
    return false;
  }

  const score = diceSimilarity(companyName, label);
  if (want) {
    return score >= FUZZY_COMPANY_MATCH_MIN;
  }
  return score >= FUZZY_NO_DOMAIN_MIN;
}

function slugFromWellfoundJobUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? url.slice(0, 80);
  } catch {
    return url.slice(0, 80);
  }
}

/**
 * Wellfound listings first (URLs you already have), then RemoteOK with domain-then-fuzzy matching.
 */
export async function processIngestJobsFromSource(
  prisma: PrismaClient,
  jobService: JobService,
  payload: IngestJobsFromSourcePayload,
): Promise<void> {
  logUpdateReturnClassification({
    location: "fallbackIngestion.finalize.updateMany",
    classification: "NO_RETURN_NEEDED",
  });
  logUpdateReturnOptimized({
    location: "fallbackIngestion.finalize.updateMany",
    strategy: "updateMany",
  });
  const jobRepository = createJobRepository(prisma);
  const { companyId, companyName, domain, wellfoundUrl } = payload;

  logger.info(
    {
      event: "fallback_ingestion_started",
      companyId,
      companyName,
      canonicalName: canonicalCompanyNameKey(companyName),
      hasWellfoundUrl: Boolean(wellfoundUrl),
    },
    "fallback_ingestion_started",
  );

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true, domain: true, careersUrl: true },
  });
  if (!company) {
    logger.warn({ event: "fallback_ingestion_no_company", companyId }, "fallback_ingestion_no_company");
    return;
  }

  const companyDomain =
    domain?.trim() ||
    company.domain?.trim() ||
    extractCompanyDomain(company.careersUrl, companyId);

  let wellfoundInserted = 0;

  if (wellfoundUrl?.trim()) {
    await throttleBeforeWellfoundFetch();
    const pack = await fetchWellfoundJobsHtml(wellfoundUrl);
    if (pack) {
      const listings = extractWellfoundListingsFromHtml(pack.html).slice(0, MAX_WELLFOUND_JOBS_PER_COMPANY);
      for (const listing of listings) {
        const sourceUrl = listing.sourceUrl.split("?")[0]!;
        if (!sourceUrl.startsWith("http")) continue;
        const normalized: NormalizedJob & { companyDomain: string } = {
          title: listing.title,
          description: undefined,
          location: undefined,
          isRemote: true,
          source: "wellfound" as AtsType,
          sourceUrl,
          applyUrl: sourceUrl,
          postedAt: undefined,
          companyId,
          companyName,
          atsJobId: slugFromWellfoundJobUrl(sourceUrl),
          companyDomain,
        };
        try {
          const result = await jobService.ingestDeduplicated(normalized);
          const newContentHash = computeJobContentHash({
            title: normalized.title,
            description: normalized.description,
            applyUrl: normalized.applyUrl ?? normalized.sourceUrl,
          });
          if (result.inserted) wellfoundInserted += 1;
          if (result.canonical.contentHash !== newContentHash) {
            await enrichCanonicalJobParsedDescription(
              prisma,
              jobRepository,
              result.canonical.id,
              result.inserted,
            );
          }
          const updateRes = await prisma.job.updateMany({
            where: { id: result.canonical.id },
            data: { contentHash: newContentHash, lastProcessedAt: new Date() },
          });
          if (updateRes.count === 0) {
            throw new Error(`fallbackIngestion.wellfound.finalize.missing_row:${result.canonical.id}`);
          }
          logUpdateReturnBytesEstimate({
            location: "fallbackIngestion.wellfound.finalize",
            estimatedBytes: estimateJsonBytes({ id: result.canonical.id, contentHash: newContentHash }),
            rows: 1,
          });
        } catch (err) {
          logger.debug(
            { event: "fallback_wellfound_row_skipped", companyId, sourceUrl, err },
            "fallback_wellfound_row_skipped",
          );
        }
      }
      logger.info(
        {
          event: "wellfound_listings_parsed",
          companyId,
          fetchedUrl: pack.fetchedUrl,
          rows: listings.length,
          ingested: wellfoundInserted,
        },
        "wellfound_listings_parsed",
      );
    }
  }

  let remoteOkInserted = 0;
  try {
    await throttleBeforeRemoteOkFetch();
    markRemoteOkFetchStart();
    const res = await fetch(REMOTEOK_API, {
      signal: AbortSignal.timeout(25_000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      markRemoteOkHttpError(res.status);
      logger.warn(
        { event: "fallback_remoteok_http", status: res.status },
        "fallback_remoteok_http",
      );
    } else {
      markRemoteOkSuccess();
      const data = (await res.json()) as unknown;
      const rows = Array.isArray(data) ? data : [];
      const jobs = rows.filter(isLikelyRemoteOkJobRow);

      for (const row of jobs) {
        if (remoteOkInserted >= MAX_REMOTEOK_JOBS_PER_COMPANY) break;
        if (!remoteOkRowMatches(row, companyName, companyDomain)) continue;

        const sourceUrl = String(row.url ?? "").trim().split("?")[0]!;
        if (!sourceUrl.startsWith("http")) continue;

        const title = String(row.position ?? row.title ?? "Job").trim() || "Job";
        const applyUrl =
          typeof row.url === "string" ? row.url.trim().split("?")[0] : undefined;
        const normalized: NormalizedJob & { companyDomain: string } = {
          title,
          description: typeof row.description === "string" ? row.description : undefined,
          location: undefined,
          isRemote: true,
          source: "remoteok" as AtsType,
          sourceUrl,
          applyUrl,
          postedAt: row.date ? new Date(row.date) : undefined,
          companyId,
          companyName,
          atsJobId: typeof row.id === "string" ? row.id : undefined,
          companyDomain,
        };

        try {
          const result = await jobService.ingestDeduplicated(normalized);
          const newContentHash = computeJobContentHash({
            title: normalized.title,
            description: normalized.description,
            applyUrl: normalized.applyUrl ?? normalized.sourceUrl,
          });
          if (result.inserted) remoteOkInserted += 1;
          if (result.canonical.contentHash !== newContentHash) {
            await enrichCanonicalJobParsedDescription(
              prisma,
              jobRepository,
              result.canonical.id,
              result.inserted,
            );
          }
          const updateRes = await prisma.job.updateMany({
            where: { id: result.canonical.id },
            data: { contentHash: newContentHash, lastProcessedAt: new Date() },
          });
          if (updateRes.count === 0) {
            throw new Error(`fallbackIngestion.remoteok.finalize.missing_row:${result.canonical.id}`);
          }
          logUpdateReturnBytesEstimate({
            location: "fallbackIngestion.remoteok.finalize",
            estimatedBytes: estimateJsonBytes({ id: result.canonical.id, contentHash: newContentHash }),
            rows: 1,
          });
        } catch (err) {
          logger.debug(
            { event: "fallback_remoteok_row_skipped", companyId, sourceUrl, err },
            "fallback_remoteok_row_skipped",
          );
        }
      }
    }
  } catch (err) {
    markRemoteOkHttpError(503);
    logger.warn({ event: "fallback_remoteok_failed", companyId, err }, "fallback_remoteok_failed");
  }

  logger.info(
    {
      event: "fallback_ingestion_complete",
      companyId,
      wellfound_jobs_ingested: wellfoundInserted,
      remoteok_jobs_ingested: remoteOkInserted,
    },
    "fallback_ingestion_complete",
  );
}
