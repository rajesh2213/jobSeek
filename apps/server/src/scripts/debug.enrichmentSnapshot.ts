/**
 * Read-only enrichment pipeline snapshot (no DB writes, no queues).
 * Writes JSON for offline analysis.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { CompanyStatus } from "@prisma/client";
import type { AtsType } from "../modules/ats/ats.interface.js";
import { isSupportedAtsType } from "../modules/ats/ats.interface.js";
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
import { prisma } from "../infrastructure/db/prisma.js";
import { resolveDomain } from "../utils/resolveDomain.js";
import { fetchCareersHtml, fetchCareersHtmlWithMeta } from "../utils/fetchCareersHtml.js";
import { logger } from "../utils/logger.js";

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

/** Mirrors companyEnrichment.service crawlableForIngest (ATS job ingest path). */
function crawlableForIngest(ats: string): boolean {
  return ats === "greenhouse" || ats === "lever" || ats === "ashby" || ats === "workday";
}

function companyHostFromDomain(domain: string | null): string | null {
  if (!domain?.trim()) return null;
  return domain.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0] ?? null;
}

function countRawHrefs(html: string | null): number {
  if (!html) return 0;
  const hrefRe = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let n = 0;
  while (hrefRe.exec(html) !== null) n++;
  return n;
}

function classifyLinkBuckets(
  links: string[],
  companyHost: string | null,
): { internalLinks: number; externalLinks: number } {
  let internalLinks = 0;
  let externalLinks = 0;
  const ch = companyHost?.replace(/^www\./i, "").toLowerCase() ?? null;
  for (const u of links) {
    try {
      const h = new URL(u).hostname.replace(/^www\./i, "").toLowerCase();
      if (!ch) {
        externalLinks++;
        continue;
      }
      if (h === ch || h.endsWith("." + ch)) internalLinks++;
      else externalLinks++;
    } catch {
      externalLinks++;
    }
  }
  return { internalLinks, externalLinks };
}

type CompanyRow = {
  id: string;
  name: string;
  domain: string | null;
  careersUrl: string | null;
  atsType: string | null;
  atsBoardToken: string | null;
};

async function analyzeCompany(company: CompanyRow) {
  const companyId = company.id;
  const companyName = company.name;

  let domain = company.domain?.trim() || null;
  let careersUrl: string | null = company.careersUrl?.trim() || null;
  let html: string | null = null;
  let links: string[] = [];
  let homepageHtml: string | null = null;
  let homepageLinks: string[] = [];
  let atsDetectedFrom: "homepage" | "careers" | null = null;
  let atsType: string | null = company.atsType ?? null;
  let atsBoardToken: string | null = company.atsBoardToken ?? null;

  let homepageUrl: string | null = null;
  let homepageMeta: { fetched: boolean; htmlLength: number; error?: string } = {
    fetched: false,
    htmlLength: 0,
  };

  if (!domain) {
    domain = await resolveDomain(prisma, company.name, companyId);
  }

  if (domain) {
    homepageUrl = homepageUrlForDomain(domain);
    const homeFetch = await fetchCareersHtmlWithMeta(homepageUrl);
    homepageHtml = homeFetch.html;
    homepageMeta = {
      fetched: homeFetch.fetched,
      htmlLength: homeFetch.htmlLength,
      ...(homeFetch.error ? { error: homeFetch.error } : {}),
    };
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
        }
      } else if (!html) {
        html = homepageHtml;
        links = homepageLinks;
      }
    }
  }

  if (domain && !atsType) {
    const careers = await detectCareersPage(domain);
    if (careers.careersUrl) {
      careersUrl = careers.careersUrl;
    }
    html = careers.html;
    if (!html && careersUrl) {
      html = await fetchCareersHtml(careersUrl);
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
    }
  }

  if (atsType && html && isSupportedAtsType(atsType)) {
    const token = atsBoardToken?.trim() || extractAtsBoardToken(atsType, html, careersUrl);
    if (token) {
      atsBoardToken = token;
    }
  }

  const canIngest =
    Boolean(atsType && atsBoardToken?.trim()) &&
    isSupportedAtsType(atsType!) &&
    crawlableForIngest(atsType!);

  const companyHost = companyHostFromDomain(domain);
  const { internalLinks, externalLinks } = classifyLinkBuckets(links, companyHost);
  const rawHrefCount = countRawHrefs(html);
  const normalizedLinksCount = links.length;

  let fallbackReason: string;
  if (canIngest) fallbackReason = "not_triggered";
  else if (!domain?.trim()) fallbackReason = "no_domain";
  else if (!atsType) fallbackReason = "no_ats";
  else if (!atsBoardToken?.trim()) fallbackReason = "token_missing";
  else if (!isSupportedAtsType(atsType)) fallbackReason = "unsupported_ats";
  else if (!crawlableForIngest(atsType)) fallbackReason = "ats_not_crawlable";
  else fallbackReason = "fallback_would_enqueue";

  return {
    companyId,
    companyName,
    domain: {
      value: domain,
      resolved: Boolean(domain?.trim()),
    },
    homepage: {
      url: homepageUrl,
      fetched: homepageMeta.fetched,
      htmlLength: homepageMeta.htmlLength,
      ...(homepageMeta.error ? { error: homepageMeta.error } : {}),
    },
    careers: {
      detected: Boolean(careersUrl),
      url: careersUrl,
    },
    linkExtraction: {
      totalLinks: normalizedLinksCount,
      internalLinks,
      externalLinks,
      sampleLinks: links.slice(0, 20),
      rawHrefCount,
      normalizedLinksCount,
    },
    ats: {
      detected: Boolean(atsType),
      type: atsType,
      detectedFrom: atsDetectedFrom,
      token: atsBoardToken,
    },
    fallback: {
      triggered: !canIngest,
      reason: fallbackReason,
    },
  };
}

async function main(): Promise<void> {
  const companies = await prisma.company.findMany({
    where: {
      status: { in: [CompanyStatus.raw, CompanyStatus.enriching] },
    },
    take: 15,
    select: {
      id: true,
      name: true,
      domain: true,
      careersUrl: true,
      atsType: true,
      atsBoardToken: true,
    },
  });

  const results = [];
  for (const c of companies) {
    results.push(await analyzeCompany(c));
  }

  const outPath =
    process.platform === "win32"
      ? path.join(tmpdir(), "enrichment-debug.json")
      : "/tmp/enrichment-debug.json";

  await mkdir(path.dirname(outPath), { recursive: true });

  const payload = {
    generatedAt: new Date().toISOString(),
    totalAnalyzed: results.length,
    results,
  };

  await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  logger.info(
    { event: "enrichment_debug_snapshot_written", outPath, count: results.length },
    `Wrote ${outPath} (${results.length} companies)`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  logger.error({ err: e, event: "enrichment_debug_snapshot_failed" }, "enrichment_debug_snapshot_failed");
  await prisma.$disconnect();
  process.exit(1);
});
