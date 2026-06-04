/**
 * Class B token recovery audit — population + stratified sample analysis.
 * Usage: cd apps/server && npx tsx scripts/audit/classBTokenRecoveryAudit.ts
 */
import { writeFileSync } from "node:fs";
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";
import { asyncPool } from "../../src/utils/asyncPool.js";
import { extractLinks } from "../../src/modules/discovery/detectors/ats.detector.js";
import { extractBoardCandidateUrls } from "../../src/modules/discovery/extractors/extractBoardUrls.js";
import { extractAshbyToken } from "../../src/modules/discovery/extractors/ashby.extractor.js";
import { extractGreenhouseToken } from "../../src/modules/discovery/extractors/greenhouse.extractor.js";
import { extractLeverToken } from "../../src/modules/discovery/extractors/lever.extractor.js";
import { extractWorkdayToken } from "../../src/modules/discovery/extractors/workday.extractor.js";
import { parseCrawlableBoard } from "../../src/modules/atsDiscovery/atsUrlParser.js";
import { fetchCareersHtmlWithMeta } from "../../src/utils/fetchCareersHtml.js";
import type { AtsType } from "../../src/modules/ats/ats.interface.js";

loadRootEnv();

const FETCH_MS = 12_000;
const CRAWLABLE = new Set(["greenhouse", "lever", "ashby", "workday"]);
const SAMPLE_SIZES: Record<string, number> = {
  greenhouse: 50,
  lever: 50,
  workday: 50,
  ashby: 25,
};

type ClassBBucket =
  | "recoverable_today"
  | "greenhouse_embed_for_param"
  | "greenhouse_board_link_hidden"
  | "greenhouse_script_json"
  | "greenhouse_no_signal"
  | "lever_job_link_present"
  | "lever_company_slug_hidden"
  | "lever_apply_link_only"
  | "lever_no_signal"
  | "workday_site_in_json"
  | "workday_board_url_present"
  | "workday_login_url_only"
  | "workday_no_signal"
  | "ashby_jobs_link_present"
  | "ashby_posting_api_only"
  | "ashby_org_hidden"
  | "ashby_no_signal"
  | "fetch_failed"
  | "js_shell_no_html"
  | "ats_not_crawlable_today";

function extractToken(atsType: string, html: string, url: string): string | null {
  if (atsType === "greenhouse") return extractGreenhouseToken(html, url);
  if (atsType === "lever") return extractLeverToken(html, url);
  if (atsType === "ashby") return extractAshbyToken(html, url);
  if (atsType === "workday") return extractWorkdayToken(html, url);
  return null;
}

function classifyClassB(
  atsType: string,
  html: string,
  careersUrl: string,
  fetched: boolean,
  token: string | null,
): { bucket: ClassBBucket; hints: string[] } {
  const blob = `${html}\n${careersUrl}`;
  const hints: string[] = [];

  if (!fetched || html.length < 500) {
    return { bucket: "fetch_failed", hints: ["fetch_failed_or_short_html"] };
  }

  if (html.length < 3000 && (blob.includes('id="root"') || blob.includes("__NEXT_DATA__"))) {
    return { bucket: "js_shell_no_html", hints: ["spa_shell"] };
  }

  if (!CRAWLABLE.has(atsType)) {
    return { bucket: "ats_not_crawlable_today", hints: [`ats=${atsType}`] };
  }

  if (token && parseCrawlableBoard(atsType as AtsType, token, careersUrl)) {
    return { bucket: "recoverable_today", hints: [`token=${token.slice(0, 60)}`] };
  }

  if (atsType === "greenhouse") {
    const hasFor = /[?&]for=([a-z0-9_-]+)/i.test(blob);
    const hasBoard = /boards\.greenhouse\.io\/([a-z0-9_-]+)/i.test(blob);
    const hasEmbed = /greenhouse\.io\/embed/i.test(blob);
    const hasJson = /"greenhouse"|grnhse|job_board_id|boardToken/i.test(blob);
    if (hasFor) hints.push("for_param_in_html");
    if (hasBoard) hints.push("board_url_in_html");
    if (hasEmbed) hints.push("embed_url_in_html");
    if (hasJson) hints.push("json_reference");
    if (hasFor) return { bucket: "greenhouse_embed_for_param", hints };
    if (hasBoard) return { bucket: "greenhouse_board_link_hidden", hints };
    if (hasJson) return { bucket: "greenhouse_script_json", hints };
    return { bucket: "greenhouse_no_signal", hints };
  }

  if (atsType === "lever") {
    const hasJobs = /jobs\.lever\.co\/([a-z0-9_-]+)/i.test(blob);
    const hasApply = /apply\.lever\.co\/([a-z0-9_-]+)/i.test(blob);
    const hasLever = /lever\.co/i.test(blob);
    if (hasJobs) hints.push("jobs_lever_co_in_html");
    if (hasApply) hints.push("apply_lever_co_in_html");
    if (hasJobs) return { bucket: "lever_job_link_present", hints };
    if (hasApply) return { bucket: "lever_apply_link_only", hints };
    if (hasLever) return { bucket: "lever_company_slug_hidden", hints };
    return { bucket: "lever_no_signal", hints };
  }

  if (atsType === "workday") {
    const hasWd = /myworkdayjobs\.com/i.test(blob);
    const hasLogin = /myworkdayjobs\.com\/[^/]+\/login/i.test(blob);
    const hasJson = /"myworkdayjobs"|wd\d+\.myworkdayjobs|workdaySite|careerSite/i.test(blob);
    if (hasLogin && !hasJson) return { bucket: "workday_login_url_only", hints: ["login_path"] };
    if (hasJson) return { bucket: "workday_site_in_json", hints: ["json_wd_ref"] };
    if (hasWd) return { bucket: "workday_board_url_present", hints: ["wd_url_in_html"] };
    return { bucket: "workday_no_signal", hints };
  }

  if (atsType === "ashby") {
    const hasJobs = /jobs\.ashbyhq\.com\/([a-z0-9_-]+)/i.test(blob);
    const hasPostingApi = /posting-api/i.test(blob);
    const hasJobBoard = /job-board\/([a-z0-9_-]+)/i.test(blob);
    if (hasJobs || hasJobBoard) hints.push("ashby_board_in_html");
    if (hasPostingApi) hints.push("posting_api_in_html");
    if (hasJobs || hasJobBoard) return { bucket: "ashby_jobs_link_present", hints };
    if (hasPostingApi) return { bucket: "ashby_posting_api_only", hints };
    if (/ashbyhq\.com/i.test(blob)) return { bucket: "ashby_org_hidden", hints };
    return { bucket: "ashby_no_signal", hints };
  }

  return { bucket: "ats_not_crawlable_today", hints };
}

async function sampleByAtsType(atsType: string, limit: number) {
  return prisma.$queryRaw<
    Array<{
      id: string;
      name: string;
      careersUrl: string;
      atsType: string;
      status: string;
      discoverySource: string | null;
    }>
  >`
    SELECT c.id, c.name, c."careersUrl", c."atsType", c.status::text AS status, c."discoverySource"
    FROM "Company" c
    WHERE c."atsType" = ${atsType}
      AND (c."atsBoardToken" IS NULL OR TRIM(c."atsBoardToken") = '')
      AND NOT EXISTS (SELECT 1 FROM "AtsEndpoint" e WHERE e."companyId" = c.id AND e."isActive" = true)
    ORDER BY RANDOM()
    LIMIT ${limit}
  `;
}

async function probeCompany(c: {
  id: string;
  name: string;
  careersUrl: string;
  atsType: string;
  status: string;
}) {
  const url = c.careersUrl?.trim() ?? "";
  const meta = await fetchCareersHtmlWithMeta(url, FETCH_MS);
  const html = meta.html ?? "";
  const links = extractLinks(html, url);
  const candidateUrls = extractBoardCandidateUrls(html, url);
  const token = extractToken(c.atsType, html, url);
  const { bucket, hints } = classifyClassB(c.atsType, html, url, meta.fetched, token);

  return {
    companyId: c.id,
    name: c.name,
    careersUrl: url,
    atsType: c.atsType,
    status: c.status,
    fetched: meta.fetched,
    htmlLength: html.length,
    linkCount: links.length,
    candidateUrlCount: candidateUrls.length,
    tokenToday: token,
    crawlable: token ? parseCrawlableBoard(c.atsType as AtsType, token, url) != null : false,
    bucket,
    hints,
    fetchError: meta.error ?? null,
  };
}

async function main(): Promise<void> {
  const populationByAts = await prisma.$queryRaw<Array<{ atsType: string; cnt: bigint }>>`
    SELECT "atsType", COUNT(*)::bigint AS cnt
    FROM "Company"
    WHERE "atsType" IS NOT NULL
      AND ("atsBoardToken" IS NULL OR TRIM("atsBoardToken") = '')
      AND NOT EXISTS (SELECT 1 FROM "AtsEndpoint" e WHERE e."companyId" = "Company".id AND e."isActive" = true)
    GROUP BY "atsType"
    ORDER BY COUNT(*) DESC
  `;

  const statusBreakdown = await prisma.$queryRaw<Array<{ status: string; cnt: bigint }>>`
    SELECT status::text AS status, COUNT(*)::bigint AS cnt
    FROM "Company"
    WHERE "atsType" IS NOT NULL
      AND ("atsBoardToken" IS NULL OR TRIM("atsBoardToken") = '')
      AND NOT EXISTS (SELECT 1 FROM "AtsEndpoint" e WHERE e."companyId" = "Company".id AND e."isActive" = true)
    GROUP BY status
    ORDER BY COUNT(*) DESC
  `;

  const crawlablePopulation = await prisma.$queryRaw<[{ cnt: bigint }]>`
    SELECT COUNT(*)::bigint AS cnt
    FROM "Company"
    WHERE "atsType" IN ('greenhouse', 'lever', 'ashby', 'workday')
      AND ("atsBoardToken" IS NULL OR TRIM("atsBoardToken") = '')
      AND NOT EXISTS (SELECT 1 FROM "AtsEndpoint" e WHERE e."companyId" = "Company".id AND e."isActive" = true)
  `;

  const totalPop = populationByAts.reduce((s, r) => s + Number(r.cnt), 0);

  console.log(`Class B population: ${totalPop}`);
  console.log("Sampling...");

  const samples: Awaited<ReturnType<typeof probeCompany>>[] = [];
  for (const [atsType, limit] of Object.entries(SAMPLE_SIZES)) {
    const rows = await sampleByAtsType(atsType, limit);
    console.log(`  ${atsType}: ${rows.length}/${limit}`);
    const probed = await asyncPool(rows, 10, probeCompany);
    samples.push(...probed);
  }

  const bucketCounts = new Map<string, number>();
  for (const s of samples) {
    bucketCounts.set(s.bucket, (bucketCounts.get(s.bucket) ?? 0) + 1);
  }

  const byAtsBucket = new Map<string, Map<string, number>>();
  for (const s of samples) {
    const m = byAtsBucket.get(s.atsType) ?? new Map();
    m.set(s.bucket, (m.get(s.bucket) ?? 0) + 1);
    byAtsBucket.set(s.atsType, m);
  }

  const recoverableToday = samples.filter((s) => s.bucket === "recoverable_today").length;
  const recoverableRate = samples.length ? recoverableToday / samples.length : 0;

  const IMPLEMENTABLE_BUCKETS = new Set([
    "recoverable_today",
    "greenhouse_embed_for_param",
    "greenhouse_board_link_hidden",
    "greenhouse_script_json",
    "lever_job_link_present",
    "lever_company_slug_hidden",
    "lever_apply_link_only",
    "workday_site_in_json",
    "workday_board_url_present",
    "ashby_jobs_link_present",
    "ashby_org_hidden",
  ]);

  const implementableInSample = samples.filter((s) => IMPLEMENTABLE_BUCKETS.has(s.bucket)).length;
  const implementableRate = samples.length ? implementableInSample / samples.length : 0;
  const crawlableTotal = Number(crawlablePopulation[0]?.cnt ?? 0);

  const report = {
    generatedAt: new Date().toISOString(),
    population: {
      total: totalPop,
      byAtsType: populationByAts.map((r) => ({ atsType: r.atsType, count: Number(r.cnt) })),
      byStatus: statusBreakdown.map((r) => ({ status: r.status, count: Number(r.cnt) })),
      crawlableTotal,
    },
    sample: {
      size: samples.length,
      byAtsType: Object.fromEntries(
        Object.keys(SAMPLE_SIZES).map((t) => [t, samples.filter((s) => s.atsType === t).length]),
      ),
      bucketCounts: Object.fromEntries([...bucketCounts.entries()].sort((a, b) => b[1] - a[1])),
      byAtsTypeBucket: Object.fromEntries(
        [...byAtsBucket.entries()].map(([ats, m]) => [ats, Object.fromEntries(m)]),
      ),
      recoverableToday,
      recoverableRate,
      implementableInSample,
      implementableRate,
    },
    estimates: {
      recoverableTodayPop: Math.round(recoverableRate * crawlableTotal),
      implementablePop: Math.round(implementableRate * crawlableTotal),
      conservativePop: Math.round(recoverableRate * crawlableTotal * 0.85),
      optimisticPop: Math.round(implementableRate * crawlableTotal * 0.75),
    },
    companies: samples,
  };

  const jsonPath = "/home/ubuntu/jobSeek/docs/audit/class-b-token-recovery-audit.json";
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  console.log("\n=== Bucket counts ===");
  for (const [k, v] of [...bucketCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }
  console.log(`\nRecoverable today (sample): ${recoverableToday}/${samples.length}`);
  console.log(`Est. recoverable (crawlable pop ${crawlableTotal}): ${report.estimates.recoverableTodayPop}`);
  console.log(`Est. after extractor fixes: ${report.estimates.optimisticPop}`);
  console.log(`\nWrote ${jsonPath}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
