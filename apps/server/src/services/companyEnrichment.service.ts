import { CompanyStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { AtsType } from "../modules/ats/ats.interface.js";
import { isSupportedAtsType } from "../modules/ats/ats.interface.js";
import { parseCrawlableBoard } from "../modules/atsDiscovery/atsUrlParser.js";
import {
  createAtsEndpointService,
  dedupeRegistrationsByTypeSlug,
} from "../modules/atsEndpoint/atsEndpoint.service.js";
import {
  getIngestAtsEndpointQueue,
  INGEST_ATS_ENDPOINT_JOB,
} from "../queues/ats-endpoint.queue.js";
import { detectCareersPage } from "../modules/discovery/detectors/careers.detector.js";
import {
  detectATS,
  extractLinks,
  homepageUrlForDomain,
} from "../modules/discovery/detectors/ats.detector.js";
import { extractGreenhouseToken } from "../modules/discovery/extractors/greenhouse.extractor.js";
import { extractLeverToken } from "../modules/discovery/extractors/lever.extractor.js";
import { extractAshbyToken } from "../modules/discovery/extractors/ashby.extractor.js";
import { extractWorkdayToken } from "../modules/discovery/extractors/workday.extractor.js";
import { logger } from "../utils/logger.js";
import { fetchCareersHtml } from "../utils/fetchCareersHtml.js";
import { resolveCompanyLogoUrl } from "../utils/companyLogo.js";
import { resolveDomain } from "../utils/resolveDomain.js";
import { getBulkCompanyHint } from "../utils/companyBulkHints.js";
import { getJobQueue } from "../queues/job.queue.js";
import {
  INGEST_ATS_JOBS,
  INGEST_JOBS_FROM_SOURCE,
  INGEST_JOBS_FROM_SOURCE_URL,
} from "../modules/crawler/crawler.types.js";
import type { CrawlCompanyJobsPayload } from "../modules/crawler/crawler.types.js";
import {
  enqueueDeferredCompanyEnrichment,
} from "../queues/enrich-company.queue.js";
import { resolveDeferredEnrichmentPriority } from "./enrichmentPriority.service.js";
import {
  recordAtsDetected,
  recordEnrichmentSuccess,
  recordJobsExpandedFromCompany,
  recordPartialEnrichment,
} from "./companyDiscoveryMetrics.service.js";

export function isTransientEnrichmentError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  if (/fetch|ECONNRESET|ETIMEDOUT|timeout|aborted|network|socket|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
    return true;
  }
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: string }).code;
    if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ENOTFOUND") return true;
  }
  return false;
}

function extractAtsBoardToken(
  atsType: AtsType,
  html: string | null,
  careersUrl: string | null,
): string | null {
  if (atsType === "greenhouse") return extractGreenhouseToken(html, careersUrl);
  if (atsType === "lever") return extractLeverToken(html, careersUrl);
  if (atsType === "ashby") return extractAshbyToken(html, careersUrl);
  if (atsType === "workday") return extractWorkdayToken(html, careersUrl);
  return null;
}

function computeStatus(params: {
  domain: string | null;
  atsType: string | null;
  atsBoardToken: string | null;
}): CompanyStatus {
  const hasReadyAts =
    Boolean(params.atsBoardToken?.trim()) &&
    Boolean(params.atsType) &&
    isSupportedAtsType(params.atsType!);
  if (hasReadyAts) return CompanyStatus.ready;
  if (params.domain?.trim()) return CompanyStatus.enriching;
  return CompanyStatus.raw;
}

/** ATS types with extractors + ingest wired from enrichment. */
function crawlableForIngest(ats: AtsType): boolean {
  return ats === "greenhouse" || ats === "lever" || ats === "ashby" || ats === "workday";
}

export type EnrichmentStage =
  | "none"
  | "domain_found"
  | "careers_found"
  | "ats_found"
  | "token_found";

function computeEnrichmentStage(params: {
  domain: string | null;
  careersUrl: string | null;
  atsType: string | null;
  atsBoardToken: string | null;
}): EnrichmentStage {
  if (!params.domain?.trim()) return "none";
  if (!params.atsType) {
    if (!params.careersUrl?.trim()) return "domain_found";
    return "careers_found";
  }
  if (!params.atsBoardToken?.trim()) return "ats_found";
  return "token_found";
}

/** Stop auto re-enqueue after this many partial enrichment runs. */
const MAX_ENRICHMENT_PARTIAL_RUNS = 14;

function mergeDiscoveryTag(existing: string | null | undefined, tag: string): string {
  const e = (existing ?? "").trim();
  if (e.includes(tag)) return e || "unknown";
  return e ? `${e}|${tag}` : tag;
}

let enrichment_total = 0;
let domain_resolved = 0;
let careers_page_detected = 0;
let html_fetched_success = 0;
let ats_detected = 0;
let token_extracted = 0;

function recordEnrichmentDebugAndCounters(params: {
  companyId: string;
  company: string;
  domain: string | null;
  careersUrl: string | null;
  homepageFetched: boolean;
  homepageLinks: number;
  atsDetectedFrom: "homepage" | "careers" | null;
  htmlFetched: boolean;
  htmlLength: number;
  linksFound: number;
  sampleLinks: string[];
  atsType: string | null;
  token: string | null;
}): void {
  enrichment_total += 1;
  if (params.domain?.trim()) domain_resolved += 1;
  if (params.careersUrl?.trim()) careers_page_detected += 1;
  if (params.htmlFetched && params.htmlLength > 0) html_fetched_success += 1;
  if (params.atsType) ats_detected += 1;
  if (params.token?.trim()) token_extracted += 1;

  logger.info(
    {
      event: "enrichment_debug",
      companyId: params.companyId,
      company: params.company,
      domain: params.domain,
      careersUrl: params.careersUrl,
      homepageFetched: params.homepageFetched,
      homepageLinks: params.homepageLinks,
      atsDetectedFrom: params.atsDetectedFrom,
      htmlFetched: params.htmlFetched,
      htmlLength: params.htmlLength,
      linksFound: params.linksFound,
      sampleLinks: params.sampleLinks,
      atsType: params.atsType,
      token: params.token,
    },
    "enrichment_debug",
  );

  if (enrichment_total % 100 === 0) {
    logger.info(
      {
        event: "ats_detection_summary",
        enrichment_total,
        domain_resolved,
        careers_page_detected,
        html_fetched_success,
        ats_detected,
        token_extracted,
      },
      `ATS Detection Summary:\n* Domain resolved: ${domain_resolved} / ${enrichment_total}\n* Careers detected: ${careers_page_detected} / ${enrichment_total}\n* HTML fetched: ${html_fetched_success}\n* ATS detected: ${ats_detected}\n* Token extracted: ${token_extracted}`,
    );
  }
}

/**
 * Progressive enrichment: never fails the pipeline for missing domain/ATS/token;
 * stores partial rows, updates status, optionally schedules delayed retry.
 * Order: domain → homepage (ATS/links) → careers page if needed → ATS from HTML → board token →
 * enqueue ingest paths → final status and partial-run caps.
 */
export async function processEnrichCompany(
  prisma: PrismaClient,
  companyId: string,
): Promise<void> {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) {
    throw new Error(`Company not found: ${companyId}`);
  }

  if (company.status === CompanyStatus.ready) {
    recordEnrichmentDebugAndCounters({
      companyId,
      company: company.name,
      domain: company.domain?.trim() ?? null,
      careersUrl: company.careersUrl?.trim() ?? null,
      homepageFetched: false,
      homepageLinks: 0,
      atsDetectedFrom: null,
      htmlFetched: false,
      htmlLength: 0,
      linksFound: 0,
      sampleLinks: [],
      atsType: company.atsType,
      token: company.atsBoardToken,
    });
    logger.info(
      { event: "enrichment_complete", companyId, reason: "already_ready" },
      "enrichment_complete",
    );
    return;
  }

  logger.info(
    {
      event: "company_enrichment_started",
      companyId,
      companyName: company.name,
      status: company.status,
    },
    "company_enrichment_started",
  );

  let domain = company.domain?.trim() || null;
  let careersUrl: string | null = company.careersUrl?.trim() || null;
  let html: string | null = null;
  let links: string[] = [];
  let homepageHtml: string | null = null;
  let homepageLinks: string[] = [];
  let atsDetectedFrom: "homepage" | "careers" | null = null;
  let atsType: string | null = company.atsType ?? null;
  let atsBoardToken: string | null = company.atsBoardToken ?? null;

  try {
    if (!domain) {
      try {
        domain = await resolveDomain(prisma, company.name, companyId);
      } catch (err) {
        if (isTransientEnrichmentError(err)) throw err;
        logger.warn({ event: "domain_resolve_error", companyId, err }, "domain_resolve_error");
      }
      if (domain) {
        await prisma.company.update({
          where: { id: companyId },
          data: { domain },
        });
        logger.info({ event: "domain_resolved", companyId, domain }, "domain_resolved");
      } else {
        logger.info({ event: "domain_missing", companyId, companyName: company.name }, "domain_missing");
      }
    }

    if (domain && !company.logoUrl?.trim()) {
      try {
        const logoUrl = await resolveCompanyLogoUrl(domain);
        if (logoUrl) {
          await prisma.company.update({
            where: { id: companyId },
            data: { logoUrl },
          });
        }
      } catch (err) {
        if (isTransientEnrichmentError(err)) throw err;
        logger.warn(
          { event: "company_logo_resolve_failed", companyId, domain, err },
          "company_logo_resolve_failed",
        );
      }
    }

    if (domain) {
      const homepageUrl = homepageUrlForDomain(domain);
      try {
        homepageHtml = await fetchCareersHtml(homepageUrl);
      } catch (err) {
        if (isTransientEnrichmentError(err)) throw err;
        logger.warn({ event: "homepage_fetch_failed", companyId, err }, "homepage_fetch_failed");
      }
      if (homepageHtml) {
        homepageLinks = extractLinks(homepageHtml, homepageUrl);
        if (!atsType) {
          const homeDetection = detectATS({
            html: homepageHtml,
            links: homepageLinks,
            baseUrl: homepageUrl,
          });
          if (homeDetection.type) {
            atsType = homeDetection.type;
            if (homeDetection.token) {
              atsBoardToken = homeDetection.token;
            }
            atsDetectedFrom = "homepage";
            html = homepageHtml;
            links = homepageLinks;
            await prisma.company.update({
              where: { id: companyId },
              data: { atsType },
            });
            recordAtsDetected();
            logger.info(
              { event: "ats_detected", companyId, atsType, source: "homepage" },
              "ats_detected",
            );
          }
        } else if (!html) {
          html = homepageHtml;
          links = homepageLinks;
        }
      }
    }

    if (domain && !atsType) {
      try {
        const careers = await detectCareersPage(domain);
        if (careers.careersUrl) {
          careersUrl = careers.careersUrl;
          await prisma.company.update({
            where: { id: companyId },
            data: { careersUrl },
          });
          logger.info(
            { event: "careers_detected", companyId, careersUrl },
            "careers_detected",
          );
        }
        html = careers.html;
        if (!html && careersUrl) {
          html = await fetchCareersHtml(careersUrl);
        }
      } catch (err) {
        if (isTransientEnrichmentError(err)) throw err;
        logger.warn({ event: "careers_detection_failed", companyId, err }, "careers_detection_failed");
      }
    }

    if (!atsType && !html && careersUrl) {
      html = await fetchCareersHtml(careersUrl);
    }

    if (!atsType && !html && homepageHtml && domain) {
      html = homepageHtml;
      links = homepageLinks.length
        ? homepageLinks
        : extractLinks(homepageHtml, homepageUrlForDomain(domain));
    }

    if (!atsType && html) {
      const baseForAts = careersUrl ?? (domain ? homepageUrlForDomain(domain) : null);
      links = extractLinks(html, baseForAts);
      const detection = detectATS({ html, links, baseUrl: baseForAts });
      if (detection.type) {
        atsType = detection.type;
        if (detection.token) {
          atsBoardToken = detection.token;
        }
        atsDetectedFrom = "careers";
        await prisma.company.update({
          where: { id: companyId },
          data: { atsType },
        });
        recordAtsDetected();
        logger.info(
          { event: "ats_detected", companyId, atsType, source: "careers" },
          "ats_detected",
        );
      } else {
        logger.info({ event: "no_ats_detected", companyId }, "no_ats_detected");
      }
    }

    if (atsType && html && isSupportedAtsType(atsType)) {
      const token = atsBoardToken?.trim() || extractAtsBoardToken(atsType, html, careersUrl);
      if (token) {
        atsBoardToken = token;
        await prisma.company.update({
          where: { id: companyId },
          data: { atsBoardToken: token },
        });
        logger.info({ event: "token_extracted", companyId, atsType }, "token_extracted");
      }
    }

    const canIngest =
      Boolean(atsType && atsBoardToken?.trim()) &&
      isSupportedAtsType(atsType!) &&
      crawlableForIngest(atsType as AtsType);

    const jobSourceUrl =
      links.find((l) => /career|job|apply|join/i.test(l)) || careersUrl || null;

    if (canIngest) {
      const payload: CrawlCompanyJobsPayload = {
        companyId: company.id,
        companyName: company.name,
        atsType: atsType as AtsType,
        atsBoardToken: atsBoardToken!,
        greenhouseBoardToken: atsBoardToken!,
      };
      const queue = getJobQueue();
      try {
        await queue.add(INGEST_ATS_JOBS, payload, {
          jobId: `ingest-ats-${company.id}-${Date.now()}`,
        });
        recordJobsExpandedFromCompany();
        logger.info(
          { event: "jobs_expanded_from_company", companyId, atsType },
          "jobs_expanded_from_company",
        );
      } catch (err) {
        logger.warn(
          { event: "ingest_ats_enqueue_failed", companyId, err },
          "ingest_ats_enqueue_failed",
        );
      }

      const parsedEndpoint = parseCrawlableBoard(
        atsType as AtsType,
        atsBoardToken!,
        careersUrl,
      );
      if (parsedEndpoint) {
        const atsEndpointService = createAtsEndpointService(prisma);
        const toRegister = dedupeRegistrationsByTypeSlug([
          {
            type: parsedEndpoint.type,
            slug: parsedEndpoint.slug,
            baseUrl: parsedEndpoint.baseUrl,
            crawlToken: parsedEndpoint.crawlToken,
            companyName: company.name,
            companyId: company.id,
          },
        ]);
        for (const reg of toRegister) {
          try {
            const endpointRow = await atsEndpointService.registerEndpoint(reg);
            if (!endpointRow) continue;
            const ingestEpQueue = getIngestAtsEndpointQueue();
            await ingestEpQueue.add(
              INGEST_ATS_ENDPOINT_JOB,
              { endpointId: endpointRow.id },
              {
                jobId: `ingest-ats-endpoint-${endpointRow.id}-${Date.now()}`,
              },
            );
            logger.info(
              {
                event: "ats_endpoint_enqueue_success",
                endpointId: endpointRow.id,
                type: endpointRow.type,
                slug: endpointRow.slug,
                companyId,
              },
              "ats_endpoint_enqueue_success",
            );
          } catch (err) {
            logger.warn(
              {
                event: "ingest_ats_endpoint_parallel_enqueue_failed",
                companyId,
                err,
              },
              "ingest_ats_endpoint_parallel_enqueue_failed",
            );
          }
        }
      }
    } else if (jobSourceUrl?.trim()) {
      const queue = getJobQueue();
      try {
        await queue.add(
          INGEST_JOBS_FROM_SOURCE_URL,
          {
            companyId: company.id,
            companyName: company.name,
            url: jobSourceUrl.trim(),
          },
          {
            jobId: `ingest-source-url-${company.id}-${Date.now()}`,
            attempts: 2,
            backoff: { type: "exponential", delay: 5000 },
          },
        );
        logger.info(
          {
            event: "job_source_ingestion_enqueued",
            companyId,
            url: jobSourceUrl.trim(),
          },
          "job_source_ingestion_enqueued",
        );
      } catch (err) {
        logger.warn(
          { event: "ingest_source_url_enqueue_failed", companyId, err },
          "ingest_source_url_enqueue_failed",
        );
      }
    } else {
      const hint = getBulkCompanyHint(company.name);
      const queue = getJobQueue();
      try {
        await queue.add(
          INGEST_JOBS_FROM_SOURCE,
          {
            companyId: company.id,
            companyName: company.name,
            domain,
            wellfoundUrl: hint?.wellfoundUrl ?? null,
          },
          {
            jobId: `fallback-ingest-${company.id}-${Date.now()}`,
            attempts: 2,
            backoff: { type: "exponential", delay: 5000 },
          },
        );
        logger.info(
          {
            event: "fallback_ingestion_enqueued",
            companyId,
            hasWellfoundHint: Boolean(hint?.wellfoundUrl),
          },
          "fallback_ingestion_enqueued",
        );
      } catch (err) {
        logger.warn(
          { event: "fallback_ingestion_enqueue_failed", companyId, err },
          "fallback_ingestion_enqueue_failed",
        );
      }
    }
  } catch (err) {
    if (isTransientEnrichmentError(err)) throw err;
    logger.error(
      { event: "enrichment_unexpected_error", companyId, err },
      "enrichment_unexpected_error",
    );
  }

  recordEnrichmentDebugAndCounters({
    companyId,
    company: company.name,
    domain,
    careersUrl,
    homepageFetched: Boolean(homepageHtml && homepageHtml.length > 0),
    homepageLinks: homepageLinks.length,
    atsDetectedFrom,
    htmlFetched: Boolean(html && html.length > 0),
    htmlLength: html?.length ?? 0,
    linksFound: links.length,
    sampleLinks: links.slice(0, 5),
    atsType,
    token: atsBoardToken,
  });

  const status = computeStatus({ domain, atsType, atsBoardToken });
  const enrichmentStage = computeEnrichmentStage({
    domain,
    careersUrl,
    atsType,
    atsBoardToken,
  });

  const updated = await prisma.company.update({
    where: { id: companyId },
    data: {
      status,
      ...(status === CompanyStatus.ready
        ? { enrichmentAttempts: 0 }
        : { enrichmentAttempts: { increment: 1 } }),
    },
    select: { enrichmentAttempts: true, discoverySource: true },
  });

  if (
    status !== CompanyStatus.ready &&
    updated.enrichmentAttempts >= MAX_ENRICHMENT_PARTIAL_RUNS &&
    !updated.discoverySource?.includes("enrich_exhausted")
  ) {
    await prisma.company.update({
      where: { id: companyId },
      data: {
        discoverySource: mergeDiscoveryTag(updated.discoverySource ?? company.discoverySource, "enrich_exhausted"),
      },
    });
    logger.warn(
      {
        event: "enrichment_cap_reached",
        companyId,
        attempts: updated.enrichmentAttempts,
      },
      "enrichment_cap_reached",
    );
  }

  if (status === CompanyStatus.ready) {
    recordEnrichmentSuccess();
    logger.info(
      {
        event: "enrichment_complete",
        enrichmentStage,
        companyId,
        companyName: company.name,
        atsType,
        domain,
      },
      "enrichment_complete",
    );
    return;
  }

  recordPartialEnrichment();
  logger.info(
    {
      event: "enrichment_partial",
      enrichmentStage,
      companyId,
      status,
      enrichmentAttempts: updated.enrichmentAttempts,
      hasDomain: Boolean(domain),
      hasAtsType: Boolean(atsType),
      hasToken: Boolean(atsBoardToken?.trim()),
    },
    "enrichment_partial",
  );

  const skipDeferred =
    updated.discoverySource?.includes("enrich_exhausted") ||
    updated.enrichmentAttempts >= MAX_ENRICHMENT_PARTIAL_RUNS;

  if (skipDeferred) {
    logger.info(
      {
        event: "enrichment_deferred_skipped",
        companyId,
        reason: "cap_or_exhausted",
        attempts: updated.enrichmentAttempts,
      },
      "enrichment_deferred_skipped",
    );
    return;
  }

  const deferredPriority = await resolveDeferredEnrichmentPriority(prisma, companyId);
  await enqueueDeferredCompanyEnrichment(companyId, company.name, {
    priority: deferredPriority,
  });
}
