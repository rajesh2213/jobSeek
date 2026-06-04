/**
 * Pre-implementation audit: Class A/B, orphan linking, Class C sample.
 * Usage: cd apps/server && npx tsx scripts/audit/implementationAudit.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
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
import { parseCrawlableBoard } from "../../src/modules/atsDiscovery/atsUrlParser.js";
import { fetchCareersHtmlWithMeta } from "../../src/utils/fetchCareersHtml.js";
import { shouldFetchCareersJobDetail } from "../../src/utils/careersPageJobUrlFilter.js";
import type { AtsType } from "../../src/modules/ats/ats.interface.js";

loadRootEnv();

const CRAWLABLE = new Set(["greenhouse", "lever", "ashby", "workday"]);
const CLASS_C_SAMPLE = 100;
const FETCH_MS = 10_000;

function boardToken(type: string, html: string, url: string): string | null {
  if (type === "greenhouse") return extractGreenhouseToken(html, url);
  if (type === "lever") return extractLeverToken(html, url);
  if (type === "ashby") return extractAshbyToken(html, url);
  if (type === "workday") return extractWorkdayToken(html, url);
  return null;
}

function normalizeMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

type ClassAReason =
  | "enrich_exhausted_never_wired"
  | "ats_fields_null_in_db"
  | "parseCrawlableBoard_failed"
  | "orphan_endpoint_exists_same_slug"
  | "endpoint_linked_other_company"
  | "workday_invalid_token_site"
  | "enrichment_pending_or_stuck"
  | "unknown";

async function diagnoseClassA(company: {
  id: string;
  name: string;
  careersUrl: string | null;
  domain: string | null;
  atsType: string | null;
  atsBoardToken: string | null;
  status: string;
  discoverySource: string | null;
}): Promise<{
  liveAts: string | null;
  liveToken: string | null;
  whyNoEndpoint: ClassAReason;
  detail: string;
}> {
  const exhausted = company.discoverySource?.includes("enrich_exhausted") ?? false;
  const url = company.careersUrl?.trim();
  let liveAts: string | null = null;
  let liveToken: string | null = null;

  if (url) {
    const meta = await fetchCareersHtmlWithMeta(url, FETCH_MS);
    const html = meta.html ?? "";
    if (meta.fetched && html.length > 1000) {
      const links = extractLinks(html, url);
      const det = detectATS({ html, links, baseUrl: url });
      liveAts = det.type;
      liveToken = det.type ? boardToken(det.type, html, url) : null;
    }
  }

  const dbAts = company.atsType?.trim() ?? null;
  const dbToken = company.atsBoardToken?.trim() ?? null;
  const ats = dbAts ?? liveAts;
  const token = dbToken ?? liveToken;

  if (!ats || !token || !CRAWLABLE.has(ats)) {
    return {
      liveAts,
      liveToken,
      whyNoEndpoint: "ats_fields_null_in_db",
      detail: `DB ats=${dbAts ?? "null"} token=${dbToken ? "set" : "null"}; live=${liveAts}/${liveToken ? "token" : "no-token"}`,
    };
  }

  const parsed = parseCrawlableBoard(ats as AtsType, token, url);
  if (!parsed) {
    const reason: ClassAReason =
      ats === "workday" && token.includes("login")
        ? "workday_invalid_token_site"
        : "parseCrawlableBoard_failed";
    return { liveAts, liveToken, whyNoEndpoint: reason, detail: `parseCrawlableBoard null for ${ats}` };
  }

  const orphanEp = await prisma.atsEndpoint.findFirst({
    where: { type: parsed.type, slug: parsed.slug, companyId: null },
    select: { id: true, isActive: true, source: true },
  });
  if (orphanEp) {
    return {
      liveAts,
      liveToken,
      whyNoEndpoint: "orphan_endpoint_exists_same_slug",
      detail: `endpoint ${orphanEp.id} active=${orphanEp.isActive} source=${orphanEp.source}`,
    };
  }

  const otherEp = await prisma.atsEndpoint.findFirst({
    where: { type: parsed.type, slug: parsed.slug, companyId: { not: null } },
    select: { id: true, companyId: true },
  });
  if (otherEp && otherEp.companyId !== company.id) {
    return {
      liveAts,
      liveToken,
      whyNoEndpoint: "endpoint_linked_other_company",
      detail: `endpoint owned by ${otherEp.companyId}`,
    };
  }

  if (exhausted) {
    return {
      liveAts,
      liveToken,
      whyNoEndpoint: "enrich_exhausted_never_wired",
      detail: "discoverySource contains enrich_exhausted; enrichment skipped re-run",
    };
  }

  if (company.status === "enriching" || company.status === "raw") {
    return {
      liveAts,
      liveToken,
      whyNoEndpoint: "enrichment_pending_or_stuck",
      detail: `status=${company.status}`,
    };
  }

  return {
    liveAts,
    liveToken,
    whyNoEndpoint: "unknown",
    detail: "crawlable board parsed but no endpoint row for company",
  };
}

type TokenFailReason =
  | "ats_detected_no_token_in_html"
  | "workable_embed_only"
  | "workday_login_or_invalid_site"
  | "greenhouse_board_not_in_html"
  | "lever_company_slug_missing"
  | "ashby_posting_api_ambiguous"
  | "bamboohr_subdomain_missing"
  | "iframe_only_not_scanned"
  | "ats_not_crawlable_today"
  | "db_has_ats_no_live_fetch";

function diagnoseTokenFailure(
  atsType: string | null,
  html: string,
  careersUrl: string,
  links: string[],
): TokenFailReason {
  if (!atsType) return "ats_detected_no_token_in_html";
  if (!CRAWLABLE.has(atsType) && atsType !== "workable") return "ats_not_crawlable_today";

  if (atsType === "workable") {
    const hasApply = /apply\.workable\.com\/[a-z0-9_-]+/i.test(`${html}\n${careersUrl}`);
    if (!hasApply && /workable\.com/i.test(html)) return "workable_embed_only";
  }

  if (atsType === "workday") {
    const tok = extractWorkdayToken(html, careersUrl);
    if (!tok) return "workday_login_or_invalid_site";
    if (tok.includes("login")) return "workday_login_or_invalid_site";
  }

  if (atsType === "greenhouse") {
    if (!extractGreenhouseToken(html, careersUrl)) return "greenhouse_board_not_in_html";
  }

  if (atsType === "lever") {
    if (!extractLeverToken(html, careersUrl)) return "lever_company_slug_missing";
  }

  if (atsType === "ashby") {
    if (!extractAshbyToken(html, careersUrl)) return "ashby_posting_api_ambiguous";
  }

  const iframeAts = links.some((l) => ATS_PATTERNS.some((p) => p.type === atsType && p.regex.test(l)));
  if (!iframeAts && html.includes("<iframe")) return "iframe_only_not_scanned";

  return "ats_detected_no_token_in_html";
}

function matchOrphanEndpoint(ep: {
  type: string;
  slug: string;
  baseUrl: string;
  companyName: string | null;
}): Promise<{ companyId: string | null; companyName: string | null; confidence: number; strategy: string }> {
  return (async () => {
    const byToken = await prisma.company.findFirst({
      where: {
        atsType: ep.type,
        atsBoardToken: { contains: ep.slug, mode: "insensitive" },
      },
      select: { id: true, name: true },
    });
    if (byToken) {
      return { companyId: byToken.id, companyName: byToken.name, confidence: 3, strategy: "atsBoardToken_contains_slug" };
    }

    if (ep.companyName) {
      const byName = await prisma.company.findFirst({
        where: { name: { equals: ep.companyName, mode: "insensitive" } },
        select: { id: true, name: true },
      });
      if (byName) {
        return { companyId: byName.id, companyName: byName.name, confidence: 2, strategy: "exact_company_name" };
      }
      const norm = normalizeMatch(ep.companyName);
      if (norm.length >= 4) {
        const fuzzy = await prisma.company.findFirst({
          where: {
            OR: [
              { slug: { contains: ep.slug, mode: "insensitive" } },
              { name: { contains: ep.companyName.slice(0, 20), mode: "insensitive" } },
            ],
          },
          select: { id: true, name: true },
        });
        if (fuzzy) {
          return { companyId: fuzzy.id, companyName: fuzzy.name, confidence: 2, strategy: "fuzzy_name_or_slug" };
        }
      }
    }

    try {
      const host = new URL(ep.baseUrl).hostname.replace(/^www\./, "");
      const domainPart = host.split(".")[0];
      if (domainPart && domainPart.length >= 4) {
        const byDomain = await prisma.company.findFirst({
          where: {
            OR: [
              { domain: { contains: domainPart, mode: "insensitive" } },
              { slug: { contains: domainPart, mode: "insensitive" } },
            ],
          },
          select: { id: true, name: true },
        });
        if (byDomain) {
          return { companyId: byDomain.id, companyName: byDomain.name, confidence: 1, strategy: "domain_from_baseUrl" };
        }
      }
    } catch {
      /* skip */
    }

    return { companyId: null, companyName: null, confidence: 0, strategy: "no_match" };
  })();
}

async function auditClassCSample(company: {
  id: string;
  name: string;
  careersUrl: string;
}): Promise<{
  companyId: string;
  name: string;
  careersUrl: string;
  jobLinkCount: number;
  jobLinksSample: string[];
  hasPagination: boolean;
  hasJobSchema: boolean;
  hasStructuredData: boolean;
  extractableWithoutBrowser: boolean;
  estJobCount: number;
  notes: string;
}> {
  const meta = await fetchCareersHtmlWithMeta(company.careersUrl, FETCH_MS);
  const html = meta.html ?? "";
  const links = Array.from(
    new Set([...extractLinks(html, company.careersUrl), ...extractLinksNearJobKeywords(html, company.careersUrl)]),
  );
  const jobLinks = links.filter((l) => shouldFetchCareersJobDetail(l));
  const lower = html.toLowerCase();
  const hasPagination =
    lower.includes("pagination") ||
    lower.includes("page=") ||
    lower.includes("load more") ||
    lower.includes("next page") ||
    /page\/\d+/i.test(html);
  const hasJobSchema = lower.includes("jobposting") && lower.includes("application/ld+json");
  const hasStructuredData = lower.includes("application/ld+json");
  const jsShell =
    html.length < 12_000 &&
    (lower.includes('id="root"') || lower.includes("__next_data__")) &&
    jobLinks.length < 2;
  const listingCount = (html.match(/class="[^"]*job[^"]*"/gi) ?? []).length;
  const estJobCount = Math.max(jobLinks.length, hasJobSchema ? 3 : 0, listingCount >= 5 ? Math.min(listingCount, 50) : 0);
  const extractableWithoutBrowser = !jsShell && (jobLinks.length >= 1 || hasJobSchema || html.length >= 8000);

  return {
    companyId: company.id,
    name: company.name,
    careersUrl: company.careersUrl,
    jobLinkCount: jobLinks.length,
    jobLinksSample: jobLinks.slice(0, 5),
    hasPagination,
    hasJobSchema,
    hasStructuredData,
    extractableWithoutBrowser,
    estJobCount,
    notes: jsShell ? "js_shell_likely" : jobLinks.length === 0 ? "no_detail_links" : "ok",
  };
}

async function main(): Promise<void> {
  // --- Part 1: Class A (DB crawlable + live audit sample) ---
  const classADb = await prisma.$queryRaw<
    Array<{
      id: string;
      name: string;
      careersUrl: string | null;
      domain: string | null;
      atsType: string | null;
      atsBoardToken: string | null;
      status: string;
      discoverySource: string | null;
    }>
  >`
    SELECT c.id, c.name, c."careersUrl", c.domain, c."atsType", c."atsBoardToken", c.status::text AS status, c."discoverySource"
    FROM "Company" c
    WHERE c."careersUrl" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "AtsEndpoint" e WHERE e."companyId" = c.id)
      AND c."atsType" IN ('greenhouse', 'lever', 'ashby', 'workday')
      AND c."atsBoardToken" IS NOT NULL
      AND TRIM(c."atsBoardToken") <> ''
  `;

  let auditRows: Array<Record<string, unknown>> = [];
  try {
    const raw = JSON.parse(
      readFileSync("/home/ubuntu/jobSeek/docs/audit/careers-valid-no-endpoint-audit-500.json", "utf8"),
    ) as { rows?: Array<Record<string, unknown>> };
    auditRows = raw.rows ?? [];
  } catch {
    /* prior audit optional */
  }
  const sampleAIds = new Set(
    auditRows
      .filter((r) => r.classification === "A")
      .map((r) => String(r.companyId)),
  );

  const classAIds = new Set([...classADb.map((c) => c.id), ...sampleAIds]);
  const classACompanies = await prisma.company.findMany({
    where: { id: { in: [...classAIds] } },
    select: {
      id: true,
      name: true,
      careersUrl: true,
      domain: true,
      atsType: true,
      atsBoardToken: true,
      status: true,
      discoverySource: true,
    },
  });

  console.log(`Part 1: Diagnosing ${classACompanies.length} Class A companies...`);
  const classAReport = await asyncPool(classACompanies, 8, async (c) => {
    const d = await diagnoseClassA(c);
    return {
      companyId: c.id,
      name: c.name,
      careersUrl: c.careersUrl,
      atsType: c.atsType ?? d.liveAts,
      token: (c.atsBoardToken ?? d.liveToken ?? "").slice(0, 120),
      dbAtsType: c.atsType,
      dbToken: c.atsBoardToken?.slice(0, 80) ?? null,
      status: c.status,
      enrichExhausted: c.discoverySource?.includes("enrich_exhausted") ?? false,
      whyNoEndpoint: d.whyNoEndpoint,
      detail: d.detail,
    };
  });

  const classAByReason = new Map<string, typeof classAReport>();
  for (const r of classAReport) {
    const list = classAByReason.get(r.whyNoEndpoint) ?? [];
    list.push(r);
    classAByReason.set(r.whyNoEndpoint, list);
  }

  // --- Part 2: Class B ---
  const classBDb = await prisma.$queryRaw<
    Array<{ id: string; name: string; careersUrl: string | null; atsType: string | null; atsBoardToken: string | null }>
  >`
    SELECT c.id, c.name, c."careersUrl", c."atsType", c."atsBoardToken"
    FROM "Company" c
    WHERE c."careersUrl" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "AtsEndpoint" e WHERE e."companyId" = c.id)
      AND c."atsType" IS NOT NULL
      AND (c."atsBoardToken" IS NULL OR TRIM(c."atsBoardToken") = '')
  `;

  const sampleB = auditRows.filter((r) => r.classification === "B");
  const classBProbe = await asyncPool(
    sampleB.slice(0, 40) as Array<{
      companyId: string;
      name: string;
      careersUrl: string;
      productionAts: string | null;
    }>,
    10,
    async (row) => {
      const url = row.careersUrl;
      const meta = await fetchCareersHtmlWithMeta(url, FETCH_MS);
      const html = meta.html ?? "";
      const links = extractLinks(html, url);
      const ats = row.productionAts ?? detectATS({ html, links, baseUrl: url }).type;
      const reason = diagnoseTokenFailure(ats, html, url, links);
      return {
        companyId: row.companyId,
        name: row.name,
        careersUrl: url,
        atsType: ats,
        tokenFailureReason: reason,
      };
    },
  );

  const bByReason = new Map<string, number>();
  for (const r of classBProbe) {
    bByReason.set(r.tokenFailureReason, (bByReason.get(r.tokenFailureReason) ?? 0) + 1);
  }

  // --- Part 3: Orphans ---
  const orphans = await prisma.atsEndpoint.findMany({
    where: { companyId: null, isActive: true },
    select: { id: true, type: true, slug: true, baseUrl: true, companyName: true, source: true, score: true },
  });

  console.log(`Part 3: Matching ${orphans.length} orphan endpoints...`);
  const orphanMatches = await asyncPool(orphans, 20, async (ep) => {
    const m = await matchOrphanEndpoint(ep);
    const alreadyHasEndpoint = m.companyId
      ? await prisma.atsEndpoint.count({ where: { companyId: m.companyId, isActive: true } })
      : 0;
    return {
      endpointId: ep.id,
      type: ep.type,
      slug: ep.slug,
      baseUrl: ep.baseUrl,
      endpointCompanyName: ep.companyName,
      source: ep.source,
      score: ep.score,
      matchedCompanyId: m.companyId,
      matchedCompanyName: m.companyName,
      confidence: m.confidence,
      strategy: m.strategy,
      companyAlreadyHasEndpoint: alreadyHasEndpoint > 0,
      netNewCompanyGain: m.confidence >= 2 && m.companyId && alreadyHasEndpoint === 0 ? 1 : 0,
    };
  });

  const orphanGain = orphanMatches.filter((m) => m.netNewCompanyGain === 1).length;
  const orphanGainConf3 = orphanMatches.filter((m) => m.netNewCompanyGain === 1 && m.confidence >= 3).length;

  // --- Part 4: Class C sample ---
  const classCIds = auditRows
    .filter((r) => r.classification === "C")
    .map((r) => String(r.companyId));
  const shuffled = classCIds.sort(() => Math.random() - 0.5).slice(0, CLASS_C_SAMPLE);
  const classCCompanies = await prisma.company.findMany({
    where: { id: { in: shuffled } },
    select: { id: true, name: true, careersUrl: true },
  });

  console.log(`Part 4: Probing ${classCCompanies.length} Class C companies...`);
  const classCReport = await asyncPool(
    classCCompanies.filter((c) => c.careersUrl),
    10,
    (c) => auditClassCSample({ id: c.id, name: c.name, careersUrl: c.careersUrl! }),
  );

  const cExtractable = classCReport.filter((r) => r.extractableWithoutBrowser).length;
  const cEstJobs = classCReport.reduce((s, r) => s + r.estJobCount, 0);
  const cScale = 836 / 155;

  const report = {
    generatedAt: new Date().toISOString(),
    part1_classA: {
      total: classAReport.length,
      byReason: Object.fromEntries([...classAByReason.entries()].map(([k, v]) => [k, v.length])),
      companies: classAReport,
    },
    part2_classB: {
      dbAtsWithoutToken: classBDb.length,
      sampleProbed: classBProbe.length,
      byTokenFailureReason: Object.fromEntries(bByReason),
      sampleCompanies: classBProbe,
      dbCompanies: classBDb.slice(0, 50),
    },
    part3_orphans: {
      total: orphans.length,
      netNewCompanyGain: orphanGain,
      netNewCompanyGainConfidence3: orphanGainConf3,
      matches: orphanMatches,
    },
    part4_classC: {
      sampleSize: classCReport.length,
      extractableWithoutBrowser: cExtractable,
      extractablePct: classCReport.length ? (100 * cExtractable) / classCReport.length : 0,
      estJobsInSample: cEstJobs,
      estJobsPop: Math.round(cEstJobs * cScale),
      estRecoverableCompaniesPop: Math.round(cExtractable * cScale),
      withPagination: classCReport.filter((r) => r.hasPagination).length,
      withJobSchema: classCReport.filter((r) => r.hasJobSchema).length,
      companies: classCReport,
    },
    implementationRanking: [] as Array<Record<string, unknown>>,
  };

  const projects = [
    {
      id: "orphan_link_conf2",
      name: "Link orphan endpoints (confidence ≥2)",
      effort: 2,
      companyGain: orphanGain,
      jobGain: orphanGain * 15,
      subscriptionImpact: 2,
    },
    {
      id: "class_a_wire",
      name: "Wire Class A enrichment → endpoint (re-run / backfill)",
      effort: 3,
      companyGain: classAReport.filter((r) => r.whyNoEndpoint === "enrich_exhausted_never_wired" || r.whyNoEndpoint === "orphan_endpoint_exists_same_slug").length,
      jobGain: classAReport.length * 20,
      subscriptionImpact: 4,
    },
    {
      id: "token_extractors",
      name: "Fix ATS token extractors (Class B)",
      effort: 5,
      companyGain: Math.round(classBDb.length * 0.4 + sampleB.length * 0.5),
      jobGain: 800,
      subscriptionImpact: 4,
    },
    {
      id: "internal_careers_crawler",
      name: "Internal careers page job crawler (Class C)",
      effort: 8,
      companyGain: Math.round(cExtractable * cScale),
      jobGain: Math.round(cEstJobs * cScale),
      subscriptionImpact: 5,
    },
    {
      id: "playwright",
      name: "Playwright careers fallback",
      effort: 7,
      companyGain: 59,
      jobGain: 200,
      subscriptionImpact: 2,
    },
    {
      id: "careers_url_validation",
      name: "Careers URL validation (reject soft-404)",
      effort: 4,
      companyGain: 0,
      jobGain: 0,
      subscriptionImpact: 1,
    },
  ];

  projects.sort((a, b) => b.subscriptionImpact * b.companyGain - a.subscriptionImpact * a.companyGain);
  report.implementationRanking = projects.map((p, i) => ({ rank: i + 1, ...p }));

  const outPath = "/home/ubuntu/jobSeek/docs/audit/implementation-audit.json";
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("\n=== PART 1 CLASS A ===", classAReport.length);
  for (const [reason, list] of classAByReason) {
    console.log(`  ${reason}: ${list.length}`);
    for (const c of list.slice(0, 2)) console.log(`    - ${c.name} ${c.atsType} ${c.whyNoEndpoint}`);
  }

  console.log("\n=== PART 2 CLASS B ===");
  console.log(`  DB ats without token: ${classBDb.length}`);
  console.log("  Sample failure reasons:", Object.fromEntries(bByReason));

  console.log("\n=== PART 3 ORPHANS ===");
  console.log(`  Total: ${orphans.length}, net new company gain: ${orphanGain} (conf3: ${orphanGainConf3})`);

  console.log("\n=== PART 4 CLASS C (n=100) ===");
  console.log(`  Extractable static: ${cExtractable}/${classCReport.length}`);
  console.log(`  Est jobs sample: ${cEstJobs}, est pop jobs: ${report.part4_classC.estJobsPop}`);
  console.log(`  Est recoverable companies pop: ${report.part4_classC.estRecoverableCompaniesPop}`);

  console.log("\n=== IMPLEMENTATION ORDER ===");
  for (const p of report.implementationRanking) {
    console.log(`  #${p.rank} ${p.name} — companies≈${p.companyGain} jobs≈${p.jobGain} effort=${p.effort}/10`);
  }

  console.log(`\nWrote ${outPath}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
