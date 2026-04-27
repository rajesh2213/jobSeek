import type { PrismaClient } from "@prisma/client";
import type { JobService } from "../modules/job/job.service.js";
import { createJobRepository } from "../modules/job/job.repository.js";
import { enrichCanonicalJobParsedDescription } from "../modules/ai/jobDescriptionEnrichment.js";
import type { IngestJobsFromSourceUrlPayload } from "../modules/crawler/crawler.types.js";
import { extractLinks } from "../modules/discovery/detectors/ats.detector.js";
import { fetchCareersHtml, fetchCareersHtmlWithMeta } from "../utils/fetchCareersHtml.js";
import { extractCompanyDomain } from "../utils/jobFingerprint.js";
import {
  extractJobDescriptionFromHtml,
  extractJobLocationFromHtml,
  extractJobTitleFromHtml,
  extractJsonLdJobPostingFlags,
  extractJsonLdJobPostingStrict,
} from "../utils/jobDetailHtml.js";
import {
  isGarbageCareersHostPath,
  isStrongDenylistUrl,
  shouldFetchCareersJobDetail,
} from "../utils/careersPageJobUrlFilter.js";
import { asyncPool } from "../utils/asyncPool.js";
import { logger } from "../utils/logger.js";
import {
  isCareersJobSelfHealEnabled,
  isCareersJobValidationEnabled,
  validateJob,
} from "../utils/jobValidation.js";
import { applyRetryStrategies } from "../utils/jobRetryStrategies.js";
import { computeJobContentHash } from "../utils/jobContentHash.js";

const MAX_JOB_HUBS = 10;
const MAX_CANDIDATES = 50;
const MIN_DESCRIPTION_CHARS = 120;
const JOB_DETAIL_CONCURRENCY = 4;
const JOB_DETAIL_TIMEOUT_MS = 12_000;

function isJobHub(link: string): boolean {
  return /job|career|position|opening|opportunit|hiring|join|work/i.test(link);
}

/** Slug-based fallback: keep alphanumeric words; trim trailing IDs only (no blanket digit strip). */
function extractTitleFromUrlSlug(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || "";
    const decoded = decodeURIComponent(last.replace(/\.[a-z0-9]+$/i, ""));
    let s = decoded.replace(/[-_%23]+/g, " ").trim();
    s = s.replace(/[_-]?(?:jr|req)[_-]?\d+/gi, " ").replace(/\s+/g, " ").trim();
    s = s.replace(/\s+\d+$/g, "").trim();
    return s || "Job Role";
  } catch {
    return "Job Role";
  }
}

function inferRemoteFromCareersText(title: string, description: string, location: string | undefined): boolean {
  const blob = `${title}\n${description}\n${location ?? ""}`;
  return /\bremote\b/i.test(blob);
}

/**
 * Fetch HTML from enrichment-discovered URL, find job hub pages, expand, fetch job-detail HTML, ingest.
 */
export async function processIngestJobsFromSourceUrl(
  prisma: PrismaClient,
  jobService: JobService,
  payload: IngestJobsFromSourceUrlPayload,
): Promise<void> {
  const jobRepository = createJobRepository(prisma);
  const { companyId, companyName, url } = payload;
  const trimmedUrl = url?.trim();
  if (!trimmedUrl?.startsWith("http")) {
    logger.warn(
      { event: "job_source_ingestion_skipped", companyId, reason: "invalid_url" },
      "job_source_ingestion_skipped",
    );
    return;
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true, domain: true, careersUrl: true },
  });
  if (!company) {
    logger.warn({ event: "job_source_ingestion_no_company", companyId }, "job_source_ingestion_no_company");
    return;
  }

  const companyDomain =
    company.domain?.trim() ||
    extractCompanyDomain(company.careersUrl ?? trimmedUrl, companyId);

  const html = await fetchCareersHtml(trimmedUrl);
  if (!html) {
    logger.info(
      {
        event: "job_source_debug",
        companyId,
        url: trimmedUrl,
        totalExtractedLinks: 0,
        jobHubsCount: 0,
        expandedLinksCount: 0,
        finalCandidatesCount: 0,
        reason: "fetch_empty",
      },
      "job_source_debug",
    );
    logger.info(
      {
        event: "job_source_result",
        companyId,
        attempted: 0,
        inserted: 0,
        duplicates: 0,
      },
      "job_source_result",
    );
    return;
  }

  const hrefs = extractLinks(html, trimmedUrl);
  const totalExtractedLinks = hrefs.length;
  const httpLinks = [...new Set(hrefs.filter((l) => l.startsWith("http")))];

  const jobHubLinks = httpLinks.filter((l) => !isGarbageCareersHostPath(l)).filter(isJobHub);

  let hubs = jobHubLinks.slice(0, MAX_JOB_HUBS);
  if (hubs.length === 0 && isJobHub(trimmedUrl) && !isGarbageCareersHostPath(trimmedUrl)) {
    hubs = [trimmedUrl];
  }

  const jobHubsCount = hubs.length;

  const allJobLinks = new Set<string>();
  for (const hub of hubs) {
    const hubHtml = hub === trimmedUrl ? html : await fetchCareersHtml(hub);
    if (!hubHtml) continue;
    const sub = extractLinks(hubHtml, hub);
    for (const l of sub) {
      if (l.startsWith("http") && !isGarbageCareersHostPath(l)) {
        allJobLinks.add(l);
      }
    }
  }

  const expandedLinksCount = allJobLinks.size;

  logger.info({
    event: "job_filter_debug",
    totalBeforeFilter: allJobLinks.size,
    sample: [...allJobLinks].slice(0, 10),
  });

  const finalCandidates = [...allJobLinks]
    .filter((l) => shouldFetchCareersJobDetail(l) && !isGarbageCareersHostPath(l))
    .slice(0, MAX_CANDIDATES);

  logger.info({
    event: "job_filter_result",
    afterFilter: finalCandidates.length,
  });

  const finalCandidatesCount = finalCandidates.length;

  logger.info(
    {
      event: "job_source_debug",
      companyId,
      url: trimmedUrl,
      totalExtractedLinks,
      jobHubsCount,
      expandedLinksCount,
      finalCandidatesCount,
      finalCandidatesSample: finalCandidates.slice(0, 10),
    },
    "job_source_debug",
  );

  const rowResults = await asyncPool(
    finalCandidates,
    JOB_DETAIL_CONCURRENCY,
    async (link) => {
      try {
        const meta = await fetchCareersHtmlWithMeta(link, JOB_DETAIL_TIMEOUT_MS);
        if (!meta.fetched || !meta.html) {
          logger.info(
            {
              event: "job_detail_skipped_reason",
              companyId,
              sourceUrl: link,
              reason: "fetch_failed",
              detail: meta.error ?? "empty_html",
            },
            "Careers job detail not ingested",
          );
          return false;
        }

        logger.info(
          {
            event: "job_detail_fetched",
            companyId,
            sourceUrl: link,
            htmlLength: meta.htmlLength,
          },
          "Careers job detail HTML fetched",
        );

        const jsonLd = extractJsonLdJobPostingFlags(meta.html);
        const strictDesc = process.env.CAREERS_PAGE_STRICT_DESCRIPTION === "1";
        const { text: description, source: extractionSource } = extractJobDescriptionFromHtml(meta.html, {
          careersPageStrict: strictDesc,
        });
        logger.info(
          {
            event: "description_extracted_length",
            companyId,
            sourceUrl: link,
            length: description.length,
            extractionSource,
            careersPageStrict: strictDesc,
          },
          "Careers description extraction",
        );

        const validationEnabled = isCareersJobValidationEnabled();
        if (!validationEnabled && description.length < MIN_DESCRIPTION_CHARS) {
          logger.info(
            {
              event: "job_detail_skipped_reason",
              companyId,
              sourceUrl: link,
              reason: "description_too_short",
              description_extracted_length: description.length,
              extractionSource,
            },
            "Careers job detail below minimum description length",
          );
          return false;
        }

        const titleFromHtml = extractJobTitleFromHtml(meta.html, jsonLd);
        let title = titleFromHtml ?? extractTitleFromUrlSlug(link);
        let locationLine = extractJobLocationFromHtml(meta.html, jsonLd) ?? undefined;
        let descriptionText = description;

        if (validationEnabled) {
          const validation = validateJob({
            title,
            description: descriptionText,
            location: locationLine,
            sourceUrl: link,
            hasJsonLdJobPosting: jsonLd.hasJobPosting,
          });

          logger.info(
            {
              event: "job_validation_result",
              companyId,
              sourceUrl: link,
              score: validation.score,
              isValid: validation.isValid,
              reasonCount: validation.reasons.length,
              reasons: validation.reasons,
            },
            "job_validation_result",
          );

          let acceptScore = validation.score;
          let acceptReasonCount = validation.reasons.length;

          if (!validation.isValid) {
            let recovered: {
              title: string;
              description: string;
              location: string | undefined;
              strategy: string;
              retryScore: number;
              retryReasonCount: number;
            } | null = null;

            if (
              isCareersJobSelfHealEnabled() &&
              validation.score >= 20 &&
              !isStrongDenylistUrl(link)
            ) {
              const retry = applyRetryStrategies({
                html: meta.html,
                sourceUrl: link,
                previousReasons: validation.reasons,
                initialScore: validation.score,
                primary: {
                  title,
                  description: descriptionText,
                  location: locationLine,
                },
              });

              if (retry) {
                const strictJp =
                  retry.strategyUsed === "jsonld_only" ? extractJsonLdJobPostingStrict(meta.html) : null;
                const retryValidation = validateJob({
                  title: retry.title,
                  description: retry.description,
                  location: retry.location,
                  sourceUrl: link,
                  hasJsonLdJobPosting:
                    retry.strategyUsed === "jsonld_only"
                      ? Boolean(strictJp?.hasJobPosting)
                      : jsonLd.hasJobPosting,
                });

                logger.info(
                  {
                    event: "job_retry_attempt",
                    companyId,
                    sourceUrl: link,
                    strategy: retry.strategyUsed,
                    retryScore: retryValidation.score,
                    retryValid: retryValidation.isValid,
                  },
                  "job_retry_attempt",
                );

                if (
                  retryValidation.isValid &&
                  (retry.description?.length ?? 0) >= MIN_DESCRIPTION_CHARS
                ) {
                  recovered = {
                    title: retry.title ?? title,
                    description: retry.description ?? descriptionText,
                    location: retry.location ?? locationLine,
                    strategy: retry.strategyUsed,
                    retryScore: retryValidation.score,
                    retryReasonCount: retryValidation.reasons.length,
                  };
                } else {
                  logger.warn(
                    {
                      event: "job_retry_failed",
                      companyId,
                      sourceUrl: link,
                      strategy: retry.strategyUsed,
                      retryScore: retryValidation.score,
                    },
                    "job_retry_failed",
                  );
                }
              }
            }

            if (!recovered) {
              logger.warn(
                {
                  event: "job_rejected",
                  companyId,
                  sourceUrl: link,
                  score: validation.score,
                  reasonCount: validation.reasons.length,
                  reasons: validation.reasons,
                },
                "job_rejected",
              );
              return false;
            }

            title = recovered.title;
            descriptionText = recovered.description;
            locationLine = recovered.location;
            acceptScore = recovered.retryScore;
            acceptReasonCount = recovered.retryReasonCount;
            logger.info(
              {
                event: "job_recovered",
                companyId,
                sourceUrl: link,
                strategy: recovered.strategy,
                retryScore: recovered.retryScore,
              },
              "job_recovered",
            );
          }

          if (descriptionText.length < MIN_DESCRIPTION_CHARS) {
            logger.info(
              {
                event: "job_detail_skipped_reason",
                companyId,
                sourceUrl: link,
                reason: "description_too_short",
                description_extracted_length: descriptionText.length,
                extractionSource,
              },
              "Careers job detail below minimum description length after validation",
            );
            return false;
          }

          logger.info(
            {
              event: "job_accepted",
              companyId,
              sourceUrl: link,
              score: acceptScore,
              reasonCount: acceptReasonCount,
            },
            "job_accepted",
          );
        }

        const result = await jobService.ingestDeduplicated({
          title,
          description: descriptionText,
          location: locationLine,
          isRemote: inferRemoteFromCareersText(title, descriptionText, locationLine),
          source: "careers_page",
          sourceUrl: link,
          applyUrl: link,
          companyId,
          companyName: companyName || company.name,
          companyDomain,
        });
        const newContentHash = computeJobContentHash({
          title,
          description: descriptionText,
          applyUrl: link,
        });
        if (result.canonical.contentHash !== newContentHash) {
          await enrichCanonicalJobParsedDescription(
            prisma,
            jobRepository,
            result.canonical.id,
            result.inserted,
          );
        }
        await prisma.job.update({
          where: { id: result.canonical.id },
          data: { contentHash: newContentHash, lastProcessedAt: new Date() },
        });
        return result.inserted;
      } catch (err) {
        logger.debug(
          { event: "job_source_ingestion_row_skipped", companyId, sourceUrl: link, err },
          "job_source_ingestion_row_skipped",
        );
        return false;
      }
    },
  );

  const jobsInserted = rowResults.filter(Boolean).length;
  const attempted = finalCandidatesCount;
  logger.info(
    {
      event: "job_source_result",
      companyId,
      attempted,
      inserted: jobsInserted,
      duplicates: attempted - jobsInserted,
    },
    "job_source_result",
  );
}
