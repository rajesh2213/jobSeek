/**
 * Audit stored careersUrl quality vs homepage discovery.
 * Usage: cd apps/server && npx tsx scripts/audit/careersUrlQualityAudit1000.ts
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
  homepageUrlForDomain,
} from "../../src/modules/discovery/detectors/ats.detector.js";
import { fetchCareersHtmlWithMeta } from "../../src/utils/fetchCareersHtml.js";

loadRootEnv();

const SAMPLE_SIZE = 1000;
const CONCURRENCY = 12;
const TIMEOUT_MS = 10_000;
const MIN_GOOD_HTML = 5_000;

type QualityClass = "A" | "B" | "C" | "D" | "E";

const CAREERS_PATH_RES: Array<{ label: string; re: RegExp }> = [
  { label: "/careers", re: /\/careers(\/|$|\?|#)/i },
  { label: "/jobs", re: /\/jobs(\/|$|\?|#)/i },
  { label: "/join-us", re: /\/join[-_]us(\/|$|\?|#)/i },
  { label: "/work-with-us", re: /\/work[-_]with[-_]us(\/|$|\?|#)/i },
  { label: "/opportunities", re: /\/opportunities(\/|$|\?|#)/i },
];

const INTERNAL_PATH_PRIORITY = [
  "/careers",
  "/jobs",
  "/join-us",
  "/join_us",
  "/work-with-us",
  "/work_with_us",
  "/opportunities",
];

type AuditRow = {
  companyId: string;
  name: string;
  domain: string | null;
  storedCareersUrl: string;
  homepageUrl: string | null;
  homepageFetched: boolean;
  storedAlive: boolean;
  storedStatus: number | null;
  classification: QualityClass;
  recoverable: boolean;
  discoveredUrl: string | null;
  discoveredKind: "ats_board" | "internal_path" | null;
  discoveredPaths: string[];
  atsBoardUrls: string[];
  internalCareersUrls: string[];
  notes: string;
};

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

function normalizeUrlCompare(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = "";
    let path = u.pathname.replace(/\/+$/, "") || "/";
    return `${normalizeHost(u.hostname)}${path}${u.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

function siteHostFrom(domain: string | null, careersUrl: string): string | null {
  if (domain?.trim()) return normalizeHost(domain.replace(/^https?:\/\//i, "").split("/")[0]!);
  try {
    return normalizeHost(new URL(careersUrl).hostname);
  } catch {
    return null;
  }
}

function isAtsBoardUrl(url: string): boolean {
  return ATS_PATTERNS.some((p) => p.regex.test(url));
}

function isSameSite(url: string, siteHost: string): boolean {
  try {
    const h = normalizeHost(new URL(url).hostname);
    return h === siteHost || h.endsWith(`.${siteHost}`);
  } catch {
    return false;
  }
}

function internalCareersLabel(pathname: string): string | null {
  for (const { label, re } of CAREERS_PATH_RES) {
    if (re.test(pathname)) return label;
  }
  return null;
}

function pathPriority(pathname: string): number {
  const low = pathname.toLowerCase();
  for (let i = 0; i < INTERNAL_PATH_PRIORITY.length; i++) {
    if (low.includes(INTERNAL_PATH_PRIORITY[i]!)) return i;
  }
  return 99;
}

function discoverFromHomepage(
  html: string,
  homepageUrl: string,
  siteHost: string,
): { atsBoardUrls: string[]; internalCareersUrls: string[]; paths: string[] } {
  const links = Array.from(
    new Set([...extractLinks(html, homepageUrl), ...extractLinksNearJobKeywords(html, homepageUrl)]),
  );
  const atsBoardUrls: string[] = [];
  const internalCareersUrls: string[] = [];
  const paths = new Set<string>();

  for (const link of links) {
    if (isAtsBoardUrl(link)) {
      atsBoardUrls.push(link);
      continue;
    }
    if (!isSameSite(link, siteHost)) continue;
    try {
      const label = internalCareersLabel(new URL(link).pathname);
      if (label) {
        internalCareersUrls.push(link);
        paths.add(label);
      }
    } catch {
      /* skip */
    }
  }

  const detection = detectATS({ html, links, baseUrl: homepageUrl });
  if (detection.type) {
    for (const link of links) {
      if (ATS_PATTERNS.find((p) => p.type === detection.type)?.regex.test(link)) {
        if (!atsBoardUrls.includes(link)) atsBoardUrls.push(link);
      }
    }
  }

  internalCareersUrls.sort(
    (a, b) => pathPriority(new URL(a).pathname) - pathPriority(new URL(b).pathname),
  );

  return {
    atsBoardUrls: [...new Set(atsBoardUrls)],
    internalCareersUrls: [...new Set(internalCareersUrls)],
    paths: [...paths],
  };
}

function pickBestInternal(urls: string[]): string | null {
  if (urls.length === 0) return null;
  return urls[0] ?? null;
}

function pickBestAts(urls: string[]): string | null {
  if (urls.length === 0) return null;
  const scored = urls.map((u) => {
    let score = 0;
    if (/boards\.greenhouse\.io/i.test(u)) score += 10;
    if (/jobs\.lever\.co/i.test(u)) score += 10;
    if (/jobs\.ashbyhq\.com/i.test(u)) score += 10;
    if (/apply\.workable\.com/i.test(u)) score += 9;
    if (/careers\.smartrecruiters\.com/i.test(u)) score += 9;
    if (/\.bamboohr\.com\/careers/i.test(u)) score += 9;
    if (/myworkdayjobs\.com/i.test(u)) score += 8;
    if (/jobvite\.com/i.test(u)) score += 8;
    return { u, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.u ?? urls[0]!;
}

async function probeUrl(url: string): Promise<{
  ok: boolean;
  status: number | null;
  htmlLength: number;
  finalUrl: string;
}> {
  const meta = await fetchCareersHtmlWithMeta(url, TIMEOUT_MS);
  const html = meta.html ?? "";
  const ok = meta.fetched && html.length >= MIN_GOOD_HTML;
  const statusMatch = meta.error?.match(/^HTTP (\d+)/);
  return {
    ok,
    status: statusMatch ? Number(statusMatch[1]) : meta.fetched ? 200 : null,
    htmlLength: html.length,
    finalUrl: url,
  };
}

function classify(params: {
  storedCareersUrl: string;
  storedAlive: boolean;
  storedStatus: number | null;
  homepageFetched: boolean;
  atsBoardUrls: string[];
  internalCareersUrls: string[];
  bestAts: string | null;
  bestInternal: string | null;
}): { classification: QualityClass; recoverable: boolean; discoveredUrl: string | null; discoveredKind: AuditRow["discoveredKind"]; notes: string } {
  const storedNorm = normalizeUrlCompare(params.storedCareersUrl);
  const storedIsAts = isAtsBoardUrl(params.storedCareersUrl);

  if (!params.homepageFetched) {
    if (params.storedAlive) {
      return { classification: "A", recoverable: false, discoveredUrl: null, discoveredKind: null, notes: "homepage_unavailable_stored_ok" };
    }
    return { classification: "D", recoverable: false, discoveredUrl: null, discoveredKind: null, notes: "homepage_unavailable_stored_dead" };
  }

  const hasAtsSignal = params.atsBoardUrls.length > 0 || params.bestAts !== null;
  const hasInternalSignal = params.internalCareersUrls.length > 0;
  const hasAnyCareersSignal = hasAtsSignal || hasInternalSignal;

  if (params.bestAts && !storedIsAts) {
    return {
      classification: "C",
      recoverable: true,
      discoveredUrl: params.bestAts,
      discoveredKind: "ats_board",
      notes: "homepage_links_to_ats_board",
    };
  }

  if (params.bestInternal) {
    const internalNorm = normalizeUrlCompare(params.bestInternal);
    if (internalNorm !== storedNorm) {
      if (!params.storedAlive || params.storedStatus === 404) {
        return {
          classification: "B",
          recoverable: true,
          discoveredUrl: params.bestInternal,
          discoveredKind: "internal_path",
          notes: "stored_dead_or_weak_internal_discovered",
        };
      }
      return {
        classification: "B",
        recoverable: true,
        discoveredUrl: params.bestInternal,
        discoveredKind: "internal_path",
        notes: "stored_differs_from_homepage_nav",
      };
    }
  }

  if (params.storedAlive) {
    if (params.bestAts && storedIsAts && normalizeUrlCompare(params.bestAts) !== storedNorm) {
      return {
        classification: "C",
        recoverable: true,
        discoveredUrl: params.bestAts,
        discoveredKind: "ats_board",
        notes: "stored_ats_differs_from_homepage_ats",
      };
    }
    return {
      classification: "A",
      recoverable: false,
      discoveredUrl: null,
      discoveredKind: null,
      notes: hasAnyCareersSignal ? "stored_matches_discovery" : "stored_ok_no_homepage_careers_links",
    };
  }

  if (!hasAnyCareersSignal) {
    return {
      classification: "E",
      recoverable: false,
      discoveredUrl: null,
      discoveredKind: null,
      notes: "no_careers_signals_on_homepage",
    };
  }

  if (params.bestAts) {
    return {
      classification: "C",
      recoverable: true,
      discoveredUrl: params.bestAts,
      discoveredKind: "ats_board",
      notes: "stored_dead_use_ats",
    };
  }

  if (params.bestInternal) {
    return {
      classification: "B",
      recoverable: true,
      discoveredUrl: params.bestInternal,
      discoveredKind: "internal_path",
      notes: "stored_dead_use_internal",
    };
  }

  return {
    classification: "D",
    recoverable: false,
    discoveredUrl: null,
    discoveredKind: null,
    notes: "stored_dead_no_replacement",
  };
}

async function auditOne(company: {
  id: string;
  name: string;
  domain: string | null;
  careersUrl: string;
}): Promise<AuditRow> {
  const storedCareersUrl = company.careersUrl.trim();
  const siteHost = siteHostFrom(company.domain, storedCareersUrl);
  const homepageUrl = siteHost
    ? company.domain?.trim()
      ? homepageUrlForDomain(company.domain)
      : `https://${siteHost}`
    : null;

  let homepageFetched = false;
  let atsBoardUrls: string[] = [];
  let internalCareersUrls: string[] = [];
  let paths: string[] = [];

  if (homepageUrl && siteHost) {
    const homeMeta = await fetchCareersHtmlWithMeta(homepageUrl, TIMEOUT_MS);
    const homeHtml = homeMeta.html ?? "";
    if (homeMeta.fetched && homeHtml.length > 500) {
      homepageFetched = true;
      const discovered = discoverFromHomepage(homeHtml, homepageUrl, siteHost);
      atsBoardUrls = discovered.atsBoardUrls;
      internalCareersUrls = discovered.internalCareersUrls;
      paths = discovered.paths;
    }
  }

  const storedProbe = await probeUrl(storedCareersUrl);
  const bestAts = pickBestAts(atsBoardUrls);
  const bestInternal = pickBestInternal(internalCareersUrls);

  const { classification, recoverable, discoveredUrl, discoveredKind, notes } = classify({
    storedCareersUrl,
    storedAlive: storedProbe.ok,
    storedStatus: storedProbe.status,
    homepageFetched,
    atsBoardUrls,
    internalCareersUrls,
    bestAts,
    bestInternal,
  });

  let recoverableFinal = recoverable;
  let discoveredFinal = discoveredUrl;
  if (recoverable && discoveredUrl) {
    const discProbe = await probeUrl(discoveredUrl);
    if (!discProbe.ok) {
      recoverableFinal = false;
      discoveredFinal = discoveredUrl;
    }
  }

  return {
    companyId: company.id,
    name: company.name,
    domain: company.domain,
    storedCareersUrl,
    homepageUrl,
    homepageFetched,
    storedAlive: storedProbe.ok,
    storedStatus: storedProbe.status,
    classification,
    recoverable: recoverableFinal,
    discoveredUrl: discoveredFinal,
    discoveredKind,
    discoveredPaths: paths,
    atsBoardUrls: atsBoardUrls.slice(0, 5),
    internalCareersUrls: internalCareersUrls.slice(0, 5),
    notes: recoverableFinal ? notes : `${notes};discovered_probe_failed`,
  };
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const population = await prisma.$queryRaw<[{ c: bigint }]>`
    SELECT COUNT(*)::bigint AS c FROM "Company" c
    WHERE c."careersUrl" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "AtsEndpoint" e WHERE e."companyId" = c.id)
  `;
  const popN = Number(population[0]?.c ?? 0);

  const companies = await prisma.$queryRaw<
    Array<{ id: string; name: string; domain: string | null; careersUrl: string }>
  >`
    SELECT c.id, c.name, c.domain, c."careersUrl" AS "careersUrl"
    FROM "Company" c
    WHERE c."careersUrl" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "AtsEndpoint" e WHERE e."companyId" = c.id)
    ORDER BY RANDOM()
    LIMIT ${SAMPLE_SIZE}
  `;

  console.log(`Auditing ${companies.length} / ${popN} companies...`);
  const rows = await asyncPool(companies, CONCURRENCY, auditOne);
  const scale = popN / rows.length;

  const byClass = new Map<QualityClass, AuditRow[]>();
  for (const r of rows) {
    const list = byClass.get(r.classification) ?? [];
    list.push(r);
    byClass.set(r.classification, list);
  }

  const recoverable = rows.filter((r) => r.recoverable);
  const recoverableValidated = recoverable.filter((r) => r.discoveredUrl);

  const [currentEndpoints, totalCompanies] = await Promise.all([
    prisma.$queryRaw<[{ c: bigint }]>`
      SELECT COUNT(DISTINCT "companyId")::bigint AS c FROM "AtsEndpoint" WHERE "companyId" IS NOT NULL
    `,
    prisma.company.count(),
  ]);
  const endpointsNow = Number(currentEndpoints[0]?.c ?? 0);

  const ENDPOINT_YIELD_ON_URL_FIX = 0.012;

  const outPath = "/home/ubuntu/jobSeek/docs/audit/careers-url-quality-audit-1000.json";
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        sampledAt: new Date().toISOString(),
        popN,
        sample: rows.length,
        classifications: [...byClass.entries()].map(([k, v]) => ({
          class: k,
          count: v.length,
          pctSample: pct(v.length, rows.length),
          estPop: Math.round(v.length * scale),
          recoverable: v.filter((r) => r.recoverable).length,
          examples: v.slice(0, 5).map((r) => ({
            name: r.name,
            storedCareersUrl: r.storedCareersUrl,
            discoveredUrl: r.discoveredUrl,
            homepageUrl: r.homepageUrl,
            notes: r.notes,
            atsBoardUrls: r.atsBoardUrls,
            internalCareersUrls: r.internalCareersUrls,
          })),
        })),
        rows,
      },
      null,
      2,
    ),
  );

  console.log("\n=== CLASSIFICATION COUNTS ===");
  for (const cls of ["A", "B", "C", "D", "E"] as QualityClass[]) {
    const items = byClass.get(cls) ?? [];
    console.log(
      `${cls}: ${items.length} (${pct(items.length, rows.length)} sample, est pop ${Math.round(items.length * scale)}) recoverable=${items.filter((r) => r.recoverable).length}`,
    );
    for (const ex of items.slice(0, 2)) {
      console.log(`   ${ex.name}: stored=${ex.storedCareersUrl}`);
      if (ex.discoveredUrl) console.log(`   → discovered=${ex.discoveredUrl}`);
    }
  }

  const estRecoverablePop = Math.round(recoverable.length * scale);
  const estNewEndpoints = Math.round(estRecoverablePop * ENDPOINT_YIELD_ON_URL_FIX);
  console.log("\n=== RECOVERY ESTIMATE ===");
  console.log(
    JSON.stringify(
      {
        recoverableSample: recoverable.length,
        recoverableWithDiscoveredUrl: recoverableValidated.length,
        estRecoverablePop,
        endpointYieldAssumption: ENDPOINT_YIELD_ON_URL_FIX,
        estNewEndpointsPop: estNewEndpoints,
        estEndpointsAfter: endpointsNow + estNewEndpoints,
        estCoveragePct: pct(endpointsNow + estNewEndpoints, totalCompanies),
      },
      null,
      2,
    ),
  );

  console.log(`\nWrote ${outPath}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
