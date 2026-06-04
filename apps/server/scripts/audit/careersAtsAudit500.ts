/**
 * Audit 500 random companies: careersUrl set, atsType null, no AtsEndpoint.
 * Usage: cd apps/server && npx tsx scripts/audit/careersAtsAudit500.ts
 */
import { writeFileSync } from "node:fs";
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";
import {
  ATS_PATTERNS,
  detectATS,
  extractAtsToken,
  extractLinks,
} from "../../src/modules/discovery/detectors/ats.detector.js";
import { extractAshbyToken } from "../../src/modules/discovery/extractors/ashby.extractor.js";
import { extractGreenhouseToken } from "../../src/modules/discovery/extractors/greenhouse.extractor.js";
import { extractLeverToken } from "../../src/modules/discovery/extractors/lever.extractor.js";
import { extractWorkdayToken } from "../../src/modules/discovery/extractors/workday.extractor.js";
import { fetchCareersHtmlWithMeta } from "../../src/utils/fetchCareersHtml.js";
import { asyncPool } from "../../src/utils/asyncPool.js";
import type { AtsType } from "../../src/modules/ats/ats.interface.js";

loadRootEnv();

const SAMPLE_SIZE = 500;
const CONCURRENCY = 12;
const FETCH_TIMEOUT_MS = 12_000;

const CRAWLABLE_TODAY = new Set(["greenhouse", "lever", "ashby", "workday"]);
const CRAWLABLE_WITH_NEW_EXTRACTOR = new Set([
  "greenhouse",
  "lever",
  "ashby",
  "workday",
  "workable",
  "smartrecruiters",
  "bamboohr",
  "teamtailor",
  "jobvite",
]);

const EXTENDED_PATTERNS: Array<{ type: string; re: RegExp }> = [
  { type: "teamtailor", re: /teamtailor\.com/i },
  { type: "rippling", re: /rippling\.com\/(?:careers|jobs)/i },
  { type: "icims", re: /icims\.com/i },
  { type: "recruitee", re: /recruitee\.com/i },
  { type: "personio", re: /personio\.(?:de|com)/i },
  { type: "jazzhr", re: /jazzhr\.com|applytojob\.com/i },
  { type: "oracle_hcm", re: /fa\.[^/]+\.oraclecloud\.com\/hcmUI/i },
  { type: "taleo", re: /taleo\.net/i },
  { type: "phenom", re: /phenom(?:people)?\.com|phncdn\.com/i },
  { type: "pageup", re: /pageuppeople\.com/i },
  { type: "paycom", re: /paycomonline\.net/i },
  { type: "ultipro", re: /ultipro\.com|ukg\.com/i },
  { type: "myworkdaysite", re: /myworkdaysite\.com/i },
  { type: "adp", re: /workforcenow\.adp\.com|myjobs\.adp\.com/i },
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

function boardToken(atsType: string, html: string | null, careersUrl: string | null): string | null {
  if (atsType === "greenhouse") return extractGreenhouseToken(html, careersUrl);
  if (atsType === "lever") return extractLeverToken(html, careersUrl);
  if (atsType === "ashby") return extractAshbyToken(html, careersUrl);
  if (atsType === "workday") return extractWorkdayToken(html, careersUrl);
  if (atsType === "workable") return extractWorkableToken(html, careersUrl);
  if (atsType === "bamboohr") return extractBamboohrToken(html, careersUrl);
  if (atsType === "smartrecruiters") return extractSmartrecruitersToken(html, careersUrl);
  if (atsType === "teamtailor") return extractTeamtailorToken(html, careersUrl);
  if (atsType === "jobvite") return extractJobviteToken(html, careersUrl);
  return null;
}

function extractWorkableToken(html: string | null, careersUrl: string | null): string | null {
  const blob = `${html ?? ""}\n${careersUrl ?? ""}`;
  const m = blob.match(/apply\.workable\.com\/([a-z0-9_-]+)/i);
  return m?.[1]?.toLowerCase() ?? null;
}

function extractBamboohrToken(html: string | null, careersUrl: string | null): string | null {
  const blob = `${html ?? ""}\n${careersUrl ?? ""}`;
  const m = blob.match(/([a-z0-9-]+)\.bamboohr\.com/i);
  return m?.[1]?.toLowerCase() ?? null;
}

function extractSmartrecruitersToken(html: string | null, careersUrl: string | null): string | null {
  const blob = `${html ?? ""}\n${careersUrl ?? ""}`;
  const m = blob.match(/careers\.smartrecruiters\.com\/([a-z0-9_-]+)/i);
  return m?.[1]?.toLowerCase() ?? null;
}

function extractTeamtailorToken(html: string | null, careersUrl: string | null): string | null {
  const blob = `${html ?? ""}\n${careersUrl ?? ""}`;
  const m =
    blob.match(/career\.teamtailor\.com\/([a-z0-9_-]+)/i) ??
    blob.match(/([a-z0-9_-]+)\.teamtailor\.com/i);
  return m?.[1]?.toLowerCase() ?? null;
}

function extractJobviteToken(html: string | null, careersUrl: string | null): string | null {
  const blob = `${html ?? ""}\n${careersUrl ?? ""}`;
  const m = blob.match(/jobs\.jobvite\.com\/(?:jobs\/)?([a-z0-9_-]+)/i);
  return m?.[1]?.toLowerCase() ?? null;
}

function firstExtendedSignal(blob: string): string | null {
  for (const p of EXTENDED_PATTERNS) {
    if (p.re.test(blob)) return p.type;
  }
  return null;
}

function detectInIframeOnly(html: string, baseUrl: string | null): string | null {
  const iframeSrcs = extractTagSrcUrls(html, "iframe", baseUrl);
  for (const p of ATS_PATTERNS) {
    if (iframeSrcs.some((u) => p.regex.test(u))) return p.type;
  }
  for (const p of EXTENDED_PATTERNS) {
    if (iframeSrcs.some((u) => p.re.test(u))) return p.type;
  }
  return null;
}

function isJsShell(html: string): boolean {
  if (html.length >= 12_000) return false;
  const lower = html.toLowerCase();
  const shell =
    lower.includes("id=\"root\"") ||
    lower.includes("id='root'") ||
    lower.includes("__next_data__") ||
    lower.includes("ng-app") ||
    lower.includes("data-reactroot") ||
    lower.includes("vite") && lower.includes("<div id=");
  const jobHints = (html.match(/\b(job|career|position|apply)\b/gi) ?? []).length;
  return shell && jobHints < 8;
}

function hasCustomJobPageSignals(html: string): boolean {
  const lower = html.toLowerCase();
  const jobWords = (lower.match(/\b(job|career|position|opening|apply|hiring)\b/g) ?? []).length;
  const listings = lower.includes("job-list") || lower.includes("job_list") || lower.includes("vacancy");
  return jobWords >= 15 || listings;
}

type AuditRow = {
  companyId: string;
  careersUrl: string;
  fetchOk: boolean;
  htmlLength: number;
  productionAts: string | null;
  productionToken: string | null;
  extendedAts: string | null;
  iframeOnlyAts: string | null;
  jsShell: boolean;
  customJobsPage: boolean;
  primaryBucket: string;
  crawlableToday: boolean;
  crawlableWithWorkable: boolean;
  crawlableWithBamboohr: boolean;
  crawlableWithSmartrecruiters: boolean;
  crawlableWithTeamtailor: boolean;
  crawlableWithPlaywright: boolean;
};

async function auditOne(company: { id: string; careersUrl: string }): Promise<AuditRow> {
  const careersUrl = company.careersUrl;
  const meta = await fetchCareersHtmlWithMeta(careersUrl, FETCH_TIMEOUT_MS);
  const html = meta.html ?? "";
  const fetchOk = meta.fetched && html.length > 0;

  if (!fetchOk) {
    return {
      companyId: company.id,
      careersUrl,
      fetchOk: false,
      htmlLength: 0,
      productionAts: null,
      productionToken: null,
      extendedAts: null,
      iframeOnlyAts: null,
      jsShell: false,
      customJobsPage: false,
      primaryBucket: "fetch_failed",
      crawlableToday: false,
      crawlableWithWorkable: false,
      crawlableWithBamboohr: false,
      crawlableWithSmartrecruiters: false,
      crawlableWithTeamtailor: false,
      crawlableWithPlaywright: false,
    };
  }

  const links = extractLinks(html, careersUrl);
  const blob = `${html}\n${careersUrl}`;
  const prod = detectATS({ html, links, baseUrl: careersUrl });
  const productionAts = prod.type;
  const productionToken = productionAts ? boardToken(productionAts, html, careersUrl) : null;

  const extendedAts =
    productionAts ?? firstExtendedSignal(blob) ?? detectInIframeOnly(html, careersUrl);
  const iframeOnlyAts =
    !productionAts && !firstExtendedSignal(blob) ? detectInIframeOnly(html, careersUrl) : null;

  const jsShell = isJsShell(html) && !productionAts && !extendedAts;
  const customJobsPage =
    !productionAts && !extendedAts && !iframeOnlyAts && hasCustomJobPageSignals(html);

  let primaryBucket = "no_signal";
  if (productionAts && productionToken && CRAWLABLE_TODAY.has(productionAts)) {
    primaryBucket = `production_${productionAts}`;
  } else if (productionAts && !productionToken) {
    primaryBucket = `production_${productionAts}_no_token`;
  } else if (productionAts) {
    primaryBucket = `production_${productionAts}_not_crawlable_today`;
  } else if (extendedAts && CRAWLABLE_WITH_NEW_EXTRACTOR.has(extendedAts)) {
    primaryBucket = `extended_${extendedAts}`;
  } else if (iframeOnlyAts) {
    primaryBucket = `iframe_${iframeOnlyAts}`;
  } else if (jsShell) {
    primaryBucket = "js_shell";
  } else if (extendedAts) {
    primaryBucket = `custom_vendor_${extendedAts}`;
  } else if (customJobsPage) {
    primaryBucket = "custom_jobs_page";
  }

  const tokenFor = (type: string) => boardToken(type, html, careersUrl);

  return {
    companyId: company.id,
    careersUrl,
    fetchOk: true,
    htmlLength: html.length,
    productionAts,
    productionToken,
    extendedAts,
    iframeOnlyAts,
    jsShell,
    customJobsPage,
    primaryBucket,
    crawlableToday: Boolean(
      productionAts && productionToken && CRAWLABLE_TODAY.has(productionAts),
    ),
    crawlableWithWorkable:
      productionAts === "workable"
        ? Boolean(productionToken)
        : extendedAts === "workable"
          ? Boolean(tokenFor("workable"))
          : false,
    crawlableWithBamboohr:
      productionAts === "bamboohr"
        ? Boolean(productionToken)
        : extendedAts === "bamboohr"
          ? Boolean(tokenFor("bamboohr"))
          : false,
    crawlableWithSmartrecruiters:
      productionAts === "smartrecruiters"
        ? Boolean(productionToken)
        : extendedAts === "smartrecruiters"
          ? Boolean(tokenFor("smartrecruiters"))
          : false,
    crawlableWithTeamtailor:
      extendedAts === "teamtailor" ? Boolean(tokenFor("teamtailor")) : false,
    crawlableWithPlaywright: jsShell,
  };
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const population = await prisma.$queryRaw<[{ c: bigint }]>`
    SELECT COUNT(*)::bigint AS c FROM "Company" c
    WHERE c."careersUrl" IS NOT NULL
      AND c."atsType" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "AtsEndpoint" e WHERE e."companyId" = c.id)
  `;
  const popN = Number(population[0]?.c ?? 0);

  const companies = await prisma.$queryRaw<Array<{ id: string; careersUrl: string }>>`
    SELECT c.id, c."careersUrl" AS "careersUrl"
    FROM "Company" c
    WHERE c."careersUrl" IS NOT NULL
      AND c."atsType" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "AtsEndpoint" e WHERE e."companyId" = c.id)
    ORDER BY RANDOM()
    LIMIT ${SAMPLE_SIZE}
  `;

  console.log(`Auditing ${companies.length} / ${popN} population companies...`);
  const rows = await asyncPool(companies, CONCURRENCY, auditOne);

  const outPath = "/home/ubuntu/jobSeek/docs/audit/careers-ats-audit-500.json";
  writeFileSync(outPath, JSON.stringify({ sampledAt: new Date().toISOString(), popN, rows }, null, 2));

  const fetched = rows.filter((r) => r.fetchOk);
  const scale = popN / rows.length;

  const freq = new Map<string, number>();
  for (const r of rows) {
    freq.set(r.primaryBucket, (freq.get(r.primaryBucket) ?? 0) + 1);
  }
  const sortedFreq = [...freq.entries()].sort((a, b) => b[1] - a[1]);

  const gainToday = rows.filter((r) => r.crawlableToday).length;
  const gainWorkable = rows.filter((r) => r.crawlableWithWorkable).length;
  const gainBamboo = rows.filter((r) => r.crawlableWithBamboohr).length;
  const gainSr = rows.filter((r) => r.crawlableWithSmartrecruiters).length;
  const gainTt = rows.filter((r) => r.crawlableWithTeamtailor).length;
  const gainPw = rows.filter((r) => r.crawlableWithPlaywright).length;

  const [currentEndpoints, totalCompanies] = await Promise.all([
    prisma.$queryRaw<[{ c: bigint }]>`
      SELECT COUNT(DISTINCT "companyId")::bigint AS c FROM "AtsEndpoint" WHERE "companyId" IS NOT NULL
    `,
    prisma.company.count(),
  ]);
  const endpointsNow = Number(currentEndpoints[0]?.c ?? 0);

  console.log("\n=== POPULATION ===");
  console.log(JSON.stringify({ population: popN, sample: rows.length, scaleFactor: scale }, null, 2));

  console.log("\n=== FETCH ===");
  console.log(
    JSON.stringify(
      {
        fetchOk: fetched.length,
        fetchFailed: rows.length - fetched.length,
        fetchOkPct: pct(fetched.length, rows.length),
        estFetchFailedPop: Math.round((rows.length - fetched.length) * scale),
      },
      null,
      2,
    ),
  );

  console.log("\n=== PRIMARY BUCKET FREQUENCY (sample) ===");
  for (const [k, v] of sortedFreq) {
    console.log(`${k.padEnd(40)} ${String(v).padStart(4)}  (${pct(v, rows.length)} est pop ${Math.round(v * scale)})`);
  }

  console.log("\n=== PRODUCTION ATS DETECTED (any) ===");
  const prodDetected = rows.filter((r) => r.productionAts);
  const prodByType = new Map<string, number>();
  for (const r of prodDetected) {
    prodByType.set(r.productionAts!, (prodByType.get(r.productionAts!) ?? 0) + 1);
  }
  for (const [t, c] of [...prodByType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t}: ${c} (${pct(c, rows.length)})`);
  }

  console.log("\n=== OPPORTUNITY GAINS (sample → population extrapolation) ===");
  const opportunities = [
    { name: "Fix production detection + token (crawlable today)", sample: gainToday, est: Math.round(gainToday * scale) },
    { name: "Workable extractor", sample: gainWorkable, est: Math.round(gainWorkable * scale) },
    { name: "BambooHR extractor", sample: gainBamboo, est: Math.round(gainBamboo * scale) },
    { name: "SmartRecruiters extractor", sample: gainSr, est: Math.round(gainSr * scale) },
    { name: "Teamtailor extractor", sample: gainTt, est: Math.round(gainTt * scale) },
    { name: "Playwright fallback (JS shells only)", sample: gainPw, est: Math.round(gainPw * scale) },
  ];
  opportunities.sort((a, b) => b.est - a.est);
  for (const o of opportunities) {
    const after = endpointsNow + o.est;
    console.log(
      JSON.stringify({
        opportunity: o.name,
        sampleGain: o.sample,
        estPopulationGain: o.est,
        estEndpointsAfter: after,
        estCoveragePct: pct(after, totalCompanies),
      }),
    );
  }

  console.log(`\nWrote ${outPath}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
