/**
 * Audit companies with valid careersUrl but no endpoint (quality-A cohort).
 * Usage: cd apps/server && npx tsx scripts/audit/careersValidNoEndpointAudit500.ts
 */
import { writeFileSync } from "node:fs";
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";
import { asyncPool } from "../../src/utils/asyncPool.js";
import {
  ATS_PATTERNS,
  detectATS,
  extractLinks,
  extractLinksNearJobKeywords,
} from "../../src/modules/discovery/detectors/ats.detector.js";
import { extractAshbyToken } from "../../src/modules/discovery/extractors/ashby.extractor.js";
import { extractGreenhouseToken } from "../../src/modules/discovery/extractors/greenhouse.extractor.js";
import { extractLeverToken } from "../../src/modules/discovery/extractors/lever.extractor.js";
import { extractWorkdayToken } from "../../src/modules/discovery/extractors/workday.extractor.js";
import { fetchCareersHtmlWithMeta } from "../../src/utils/fetchCareersHtml.js";
import { shouldFetchCareersJobDetail } from "../../src/utils/careersPageJobUrlFilter.js";
import type { AtsType } from "../../src/modules/ats/ats.interface.js";

loadRootEnv();

const VALID_SAMPLE_TARGET = 500;
const BATCH_SIZE = 600;
const CONCURRENCY = 12;
const FETCH_TIMEOUT_MS = 12_000;
const MIN_VALID_HTML = 5_000;

const CRAWLABLE_TODAY = new Set(["greenhouse", "lever", "ashby", "workday"]);
const CRAWLABLE_EXTENDED = new Set([
  ...CRAWLABLE_TODAY,
  "workable",
  "bamboohr",
  "smartrecruiters",
  "teamtailor",
  "jobvite",
]);

type QualityClass = "A" | "B" | "C" | "D" | "E" | "F";

type AuditRow = {
  companyId: string;
  name: string;
  careersUrl: string;
  classification: QualityClass;
  htmlLength: number;
  jobsListedOnPage: boolean;
  productionAts: string | null;
  productionToken: string | null;
  extendedAts: string | null;
  externalAtsLinks: string[];
  hasJobSchema: boolean;
  hasStructuredData: boolean;
  internalJobLinkCount: number;
  marketingOnly: boolean;
  jsShell: boolean;
  gainBetterDetection: boolean;
  gainAtsLinkExtraction: boolean;
  gainInternalCrawler: boolean;
  gainPlaywright: boolean;
};

const EXTENDED_PATTERNS: Array<{ type: string; re: RegExp }> = [
  { type: "teamtailor", re: /teamtailor\.com/i },
  { type: "workable", re: /apply\.workable\.com|workable\.com/i },
  { type: "bamboohr", re: /bamboohr\.com/i },
  { type: "smartrecruiters", re: /smartrecruiters\.com/i },
  { type: "jobvite", re: /jobvite\.com/i },
  { type: "icims", re: /icims\.com/i },
  { type: "workday", re: /myworkdayjobs\.com/i },
];

function extractTagSrcUrls(html: string, tag: "script" | "iframe", baseUrl?: string | null): string[] {
  const out = new Set<string>();
  const re = new RegExp(`<${tag}\\b[^>]*\\bsrc\\s*=\\s*["']([^"']+)["'][^>]*>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1]?.trim();
    if (!raw || raw.startsWith("javascript:")) continue;
    try {
      if (/^https?:\/\//i.test(raw)) out.add(raw);
      else if (raw.startsWith("//")) out.add(`https:${raw}`);
      else if (baseUrl?.trim()) out.add(new URL(raw, baseUrl).toString());
    } catch {
      /* skip */
    }
  }
  return Array.from(out);
}

function firstExtendedSignal(blob: string): string | null {
  for (const p of EXTENDED_PATTERNS) {
    if (p.re.test(blob)) return p.type;
  }
  return null;
}

function boardToken(atsType: string, html: string, careersUrl: string): string | null {
  if (atsType === "greenhouse") return extractGreenhouseToken(html, careersUrl);
  if (atsType === "lever") return extractLeverToken(html, careersUrl);
  if (atsType === "ashby") return extractAshbyToken(html, careersUrl);
  if (atsType === "workday") return extractWorkdayToken(html, careersUrl);
  const blob = `${html}\n${careersUrl}`;
  if (atsType === "workable") {
    const m = blob.match(/apply\.workable\.com\/([a-z0-9_-]+)/i);
    return m?.[1]?.toLowerCase() ?? null;
  }
  if (atsType === "bamboohr") {
    const m = blob.match(/([a-z0-9-]+)\.bamboohr\.com/i);
    return m?.[1]?.toLowerCase() ?? null;
  }
  if (atsType === "smartrecruiters") {
    const m = blob.match(/careers\.smartrecruiters\.com\/([a-z0-9_-]+)/i);
    return m?.[1]?.toLowerCase() ?? null;
  }
  return null;
}

function isJsShell(html: string): boolean {
  if (html.length >= 12_000) return false;
  const lower = html.toLowerCase();
  const shell =
    lower.includes('id="root"') ||
    lower.includes("id='root'") ||
    lower.includes("__next_data__") ||
    lower.includes("ng-app") ||
    lower.includes("data-reactroot") ||
    (lower.includes("vite") && lower.includes("<div id="));
  const jobHints = (html.match(/\b(job|career|position|apply)\b/gi) ?? []).length;
  return shell && jobHints < 8;
}

function hasJobSchema(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes("jobposting") &&
    (lower.includes("application/ld+json") ||
      lower.includes("@type") ||
      lower.includes("schema.org"))
  );
}

function hasStructuredData(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes("application/ld+json") ||
    lower.includes("itemtype=\"https://schema.org/jobposting\"") ||
    lower.includes("itemtype='https://schema.org/jobposting'")
  );
}

function findExternalAtsLinks(links: string[], html: string): string[] {
  const sources = [...links, ...extractTagSrcUrls(html, "iframe"), ...extractTagSrcUrls(html, "script")];
  return sources.filter((u) => ATS_PATTERNS.some((p) => p.regex.test(u)));
}

function countJobsListed(html: string, links: string[], careersUrl: string): {
  jobsListed: boolean;
  internalJobLinkCount: number;
} {
  const jobLinks = links.filter((l) => shouldFetchCareersJobDetail(l));
  const lower = html.toLowerCase();
  const listingMarkers =
    (lower.match(/class="[^"]*job[^"]*"/gi) ?? []).length +
    (lower.includes("job-list") || lower.includes("job_list") ? 2 : 0) +
    (lower.includes("vacancy") || lower.includes("open-positions") ? 1 : 0);
  const jobsListed =
    jobLinks.length >= 2 ||
    hasJobSchema(html) ||
    listingMarkers >= 3 ||
    (lower.match(/\b(view|see|apply for)\s+(all\s+)?(jobs|openings|positions)\b/gi) ?? []).length > 0;
  return { jobsListed, internalJobLinkCount: jobLinks.length };
}

function isMarketingOnly(html: string, jobsListed: boolean, hasAts: boolean): boolean {
  if (jobsListed || hasAts) return false;
  const lower = html.toLowerCase();
  const jobWords = (lower.match(/\b(job|career|position|opening|apply|hiring|join our team)\b/g) ?? []).length;
  return jobWords >= 12;
}

function classifyRow(signals: {
  crawlableToday: boolean;
  productionAts: string | null;
  productionToken: string | null;
  extendedAts: string | null;
  externalAtsLinks: string[];
  jobsListed: boolean;
  internalJobLinkCount: number;
  marketingOnly: boolean;
  jsShell: boolean;
}): QualityClass {
  const externalUndetected =
    signals.externalAtsLinks.length > 0 &&
    !(signals.productionAts && signals.productionToken && CRAWLABLE_TODAY.has(signals.productionAts));

  if (signals.crawlableToday) return "A";

  if (externalUndetected) return "B";

  if (signals.productionAts && CRAWLABLE_TODAY.has(signals.productionAts) && !signals.productionToken) {
    return "B";
  }

  if (
    signals.internalJobLinkCount >= 2 ||
    (signals.jobsListed && !signals.productionAts && signals.externalAtsLinks.length === 0)
  ) {
    return "C";
  }

  if (signals.jsShell) return "E";

  if (signals.marketingOnly) return "D";

  return "F";
}

async function auditOne(company: { id: string; name: string; careersUrl: string }): Promise<AuditRow | null> {
  const careersUrl = company.careersUrl.trim();
  const meta = await fetchCareersHtmlWithMeta(careersUrl, FETCH_TIMEOUT_MS);
  const html = meta.html ?? "";
  if (!meta.fetched || html.length < MIN_VALID_HTML) return null;

  const links = Array.from(
    new Set([...extractLinks(html, careersUrl), ...extractLinksNearJobKeywords(html, careersUrl)]),
  );
  const blob = `${html}\n${careersUrl}`;
  const prod = detectATS({ html, links, baseUrl: careersUrl });
  const productionAts = prod.type;
  const productionToken = productionAts ? boardToken(productionAts, html, careersUrl) : null;
  const extendedAts = productionAts ?? firstExtendedSignal(blob);
  const externalAtsLinks = findExternalAtsLinks(links, html).slice(0, 8);
  const { jobsListed, internalJobLinkCount } = countJobsListed(html, links, careersUrl);
  const jsShell = isJsShell(html);
  const marketingOnly = isMarketingOnly(html, jobsListed, Boolean(productionAts || extendedAts));
  const crawlableToday = Boolean(
    productionAts && productionToken && CRAWLABLE_TODAY.has(productionAts),
  );

  const classification = classifyRow({
    crawlableToday,
    productionAts,
    productionToken,
    extendedAts,
    externalAtsLinks,
    jobsListed,
    internalJobLinkCount,
    marketingOnly,
    jsShell,
  });

  const extToken = extendedAts ? boardToken(extendedAts, html, careersUrl) : null;
  const gainBetterDetection =
    classification === "B" &&
    Boolean(extendedAts && CRAWLABLE_EXTENDED.has(extendedAts) && extToken);
  const gainAtsLinkExtraction =
    classification === "B" && externalAtsLinks.length > 0 && !gainBetterDetection;
  const gainInternalCrawler = classification === "C";
  const gainPlaywright = classification === "E";

  return {
    companyId: company.id,
    name: company.name,
    careersUrl,
    classification,
    htmlLength: html.length,
    jobsListedOnPage: jobsListed,
    productionAts,
    productionToken,
    extendedAts,
    externalAtsLinks,
    hasJobSchema: hasJobSchema(html),
    hasStructuredData: hasStructuredData(html),
    internalJobLinkCount,
    marketingOnly,
    jsShell,
    gainBetterDetection,
    gainAtsLinkExtraction,
    gainInternalCrawler,
    gainPlaywright,
  };
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const popEstimate = await prisma.$queryRaw<[{ c: bigint }]>`
    SELECT COUNT(*)::bigint AS c FROM "Company" c
    WHERE c."careersUrl" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "AtsEndpoint" e WHERE e."companyId" = c.id)
  `;
  const popNoEndpoint = Number(popEstimate[0]?.c ?? 0);
  const validPopEstimate = Math.round(popNoEndpoint * 0.336);

  const seen = new Set<string>();
  const validRows: AuditRow[] = [];
  let batches = 0;

  while (validRows.length < VALID_SAMPLE_TARGET && batches < 5) {
    batches += 1;
    const batch = await prisma.$queryRaw<
      Array<{ id: string; name: string; careersUrl: string }>
    >`
      SELECT c.id, c.name, c."careersUrl" AS "careersUrl"
      FROM "Company" c
      WHERE c."careersUrl" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "AtsEndpoint" e WHERE e."companyId" = c.id)
      ORDER BY RANDOM()
      LIMIT ${BATCH_SIZE}
    `;

    const fresh = batch.filter((c) => !seen.has(c.id));
    for (const c of fresh) seen.add(c.id);

    const results = await asyncPool(fresh, CONCURRENCY, auditOne);
    for (const r of results) {
      if (r && validRows.length < VALID_SAMPLE_TARGET) validRows.push(r);
    }
    console.log(`Batch ${batches}: valid=${validRows.length}/${VALID_SAMPLE_TARGET}`);
  }

  const scale = validPopEstimate / validRows.length;
  const byClass = new Map<QualityClass, AuditRow[]>();
  for (const r of validRows) {
    const list = byClass.get(r.classification) ?? [];
    list.push(r);
    byClass.set(r.classification, list);
  }

  const [currentEndpoints, totalCompanies] = await Promise.all([
    prisma.$queryRaw<[{ c: bigint }]>`
      SELECT COUNT(DISTINCT "companyId")::bigint AS c FROM "AtsEndpoint" WHERE "companyId" IS NOT NULL
    `,
    prisma.company.count(),
  ]);
  const endpointsNow = Number(currentEndpoints[0]?.c ?? 0);

  const gains = {
    betterDetection: validRows.filter((r) => r.gainBetterDetection).length,
    atsLinkExtraction: validRows.filter((r) => r.gainAtsLinkExtraction).length,
    internalCrawler: validRows.filter((r) => r.gainInternalCrawler).length,
    playwright: validRows.filter((r) => r.gainPlaywright).length,
  };

  const recoveryRates = {
    betterDetection: 0.85,
    atsLinkExtraction: 0.6,
    internalCrawler: 0.12,
    playwright: 0.3,
  };

  const outPath = "/home/ubuntu/jobSeek/docs/audit/careers-valid-no-endpoint-audit-500.json";
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        sampledAt: new Date().toISOString(),
        validPopEstimate,
        popNoEndpoint,
        sampleValid: validRows.length,
        rows: validRows,
      },
      null,
      2,
    ),
  );

  console.log("\n=== POPULATION ===");
  console.log(
    JSON.stringify(
      {
        noEndpointWithCareersUrl: popNoEndpoint,
        estValidCareersUrlPop: validPopEstimate,
        sampleValid: validRows.length,
        scaleFactor: scale,
      },
      null,
      2,
    ),
  );

  console.log("\n=== CLASSIFICATION (valid careersUrl sample) ===");
  for (const cls of ["A", "B", "C", "D", "E", "F"] as QualityClass[]) {
    const items = byClass.get(cls) ?? [];
    console.log(
      `${cls}: ${items.length} (${pct(items.length, validRows.length)} sample, est pop ${Math.round(items.length * scale)})`,
    );
    for (const ex of items.slice(0, 2)) {
      console.log(`   ${ex.name} ${ex.careersUrl} ats=${ex.productionAts} jobs=${ex.jobsListedOnPage} internal=${ex.internalJobLinkCount}`);
    }
  }

  const signalStats = {
    jobsListed: validRows.filter((r) => r.jobsListedOnPage).length,
    productionAts: validRows.filter((r) => r.productionAts).length,
    externalAtsLinks: validRows.filter((r) => r.externalAtsLinks.length > 0).length,
    jobSchema: validRows.filter((r) => r.hasJobSchema).length,
    structuredData: validRows.filter((r) => r.hasStructuredData).length,
    internalJobPages: validRows.filter((r) => r.internalJobLinkCount >= 2).length,
  };
  console.log("\n=== SIGNALS ===", JSON.stringify(signalStats, null, 2));

  console.log("\n=== OPPORTUNITY RANKING ===");
  const opportunities = [
    {
      name: "Better ATS detection",
      sample: gains.betterDetection,
      rate: recoveryRates.betterDetection,
    },
    {
      name: "ATS link extraction",
      sample: gains.atsLinkExtraction,
      rate: recoveryRates.atsLinkExtraction,
    },
    { name: "Internal job board crawler", sample: gains.internalCrawler, rate: recoveryRates.internalCrawler },
    { name: "Playwright fallback", sample: gains.playwright, rate: recoveryRates.playwright },
  ];
  opportunities.sort((a, b) => b.sample * b.rate - a.sample * a.rate);
  for (const o of opportunities) {
    const est = Math.round(o.sample * scale * o.rate);
    const after = endpointsNow + est;
    console.log(
      JSON.stringify({
        opportunity: o.name,
        eligibleSample: o.sample,
        estCompaniesGainedPop: est,
        estEndpointsAfter: after,
        estCoveragePct: pct(after, totalCompanies),
      }),
    );
  }

  const classA = byClass.get("A")?.length ?? 0;
  const estA = Math.round(classA * scale * 0.95);
  console.log(
    "\n=== CLASS A (detection gap only) ===",
    JSON.stringify({
      sample: classA,
      estPop: Math.round(classA * scale),
      estEndpointsIfDetectionFixed: estA,
      estCoveragePct: pct(endpointsNow + estA, totalCompanies),
    }),
  );

  console.log(`\nWrote ${outPath}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
