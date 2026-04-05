/**
 * ATS detection diagnostic: sample DB companies + live fetch + per-pattern trace.
 * Usage: cd apps/server && npx tsx scripts/diagnose.atsDetection.ts
 */
import { loadRootEnv } from "../src/infrastructure/env/loadEnv.js";
import { prisma } from "../src/infrastructure/db/prisma.js";
import {
  ATS_PATTERNS,
  detectATS,
  extractAtsToken,
  extractLinks,
  homepageUrlForDomain,
} from "../src/modules/discovery/detectors/ats.detector.js";
import { extractAshbyToken } from "../src/modules/discovery/extractors/ashby.extractor.js";
import { extractGreenhouseToken } from "../src/modules/discovery/extractors/greenhouse.extractor.js";
import { extractLeverToken } from "../src/modules/discovery/extractors/lever.extractor.js";
import { extractWorkdayToken } from "../src/modules/discovery/extractors/workday.extractor.js";
import { fetchCareersHtmlWithMeta } from "../src/utils/fetchCareersHtml.js";
import type { AtsType } from "../src/modules/ats/ats.interface.js";

loadRootEnv();

/** Same subset as companyEnrichment.service crawlableForIngest. */
function crawlableForIngest(ats: AtsType): boolean {
  return ats === "greenhouse" || ats === "lever" || ats === "ashby" || ats === "workday";
}

function extractTagSrcUrls(html: string, tagName: "script" | "iframe", baseUrl?: string | null): string[] {
  const out = new Set<string>();
  const re = new RegExp(`<${tagName}\\b[^>]*\\bsrc\\s*=\\s*["']([^"']+)["'][^>]*>`, "gi");
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

const SAMPLE = 20;

function snippet(s: string, n: number): string {
  return s.slice(0, n).replace(/\s+/g, " ");
}

function extractAllLinkHrefs(html: string): string[] {
  if (!html) return [];
  const out: string[] = [];
  const hrefRe = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    const raw = m[1]?.trim();
    if (raw && !raw.startsWith("#") && !raw.startsWith("javascript:")) out.push(raw);
  }
  return [...new Set(out)];
}

type PatternDiag = {
  type: string;
  htmlMatch: boolean;
  firstMatchingUrl: string | null;
  extractAtsTokenResult: string | null;
};

function diagnosePatterns(
  html: string,
  linksFromExtract: string[],
  baseUrl: string | null,
): { patterns: PatternDiag[]; detectResult: ReturnType<typeof detectATS> } {
  const scriptSrcs = extractTagSrcUrls(html, "script", baseUrl);
  const iframeSrcs = extractTagSrcUrls(html, "iframe", baseUrl);
  const merged = Array.from(new Set([...linksFromExtract, ...scriptSrcs, ...iframeSrcs]));
  const patterns: PatternDiag[] = [];

  for (const p of ATS_PATTERNS) {
    const htmlMatch = p.regex.test(html);
    const hit = merged.find((u) => p.regex.test(u));
    const token = hit ? extractAtsToken(hit, p.type) : null;
    patterns.push({
      type: p.type,
      htmlMatch,
      firstMatchingUrl: hit ?? null,
      extractAtsTokenResult: token,
    });
  }

  return { patterns, detectResult: detectATS({ html, links: linksFromExtract, baseUrl }) };
}

function boardToken(atsType: AtsType | null, html: string | null, careersUrl: string | null): string | null {
  if (!atsType) return null;
  if (atsType === "greenhouse") return extractGreenhouseToken(html, careersUrl);
  if (atsType === "lever") return extractLeverToken(html, careersUrl);
  if (atsType === "ashby") return extractAshbyToken(html, careersUrl);
  if (atsType === "workday") return extractWorkdayToken(html, careersUrl);
  return null;
}

/** Heuristic failure class for aggregate % */
function classifyFailure(params: {
  homeMeta: Awaited<ReturnType<typeof fetchCareersHtmlWithMeta>>;
  careersMeta: Awaited<ReturnType<typeof fetchCareersHtmlWithMeta>>;
  homeDiag: ReturnType<typeof diagnosePatterns> | null;
  careersDiag: ReturnType<typeof diagnosePatterns> | null;
  detectWinner: AtsType | null;
  tokenAfterExtractors: string | null;
}): "A" | "B" | "C" | "D" | "E" {
  const hLen = params.homeMeta.htmlLength;
  const cLen = params.careersMeta.htmlLength;
  if (
    (!params.homeMeta.fetched && !params.careersMeta.fetched) ||
    (hLen < 200 && cLen < 200)
  ) {
    return "D";
  }

  if (
    params.homeMeta.fetched &&
    hLen > 800 &&
    params.careersMeta.fetched &&
    cLen < 400
  ) {
    return "E";
  }

  const anyHtmlMatch =
    params.homeDiag?.patterns.some((p) => p.htmlMatch) ||
    params.careersDiag?.patterns.some((p) => p.htmlMatch);
  const anyUrlMatch =
    params.homeDiag?.patterns.some((p) => p.firstMatchingUrl) ||
    params.careersDiag?.patterns.some((p) => p.firstMatchingUrl);

  if (!params.detectWinner && !anyHtmlMatch && !anyUrlMatch) return "C";

  if (!params.detectWinner && (anyHtmlMatch || anyUrlMatch)) return "A";

  if (
    params.detectWinner &&
    !params.tokenAfterExtractors &&
    crawlableForIngest(params.detectWinner)
  ) {
    return "B";
  }

  if (params.detectWinner && !params.tokenAfterExtractors) return "B";

  return "C";
}

async function main(): Promise<void> {
  const companies = await prisma.company.findMany({
    where: {
      domain: { not: null },
      careersUrl: { not: null },
      atsType: null,
    },
    select: { id: true, name: true, domain: true, careersUrl: true },
    take: SAMPLE,
    orderBy: { updatedAt: "desc" },
  });

  console.log(JSON.stringify({ sampleSize: companies.length, note: "domain+careersUrl set, atsType null" }, null, 2));

  const bucket = { A: 0, B: 0, C: 0, D: 0, E: 0 };

  for (let i = 0; i < companies.length; i++) {
    const co = companies[i]!;
    const domain = co.domain!.trim();
    const careersUrl = co.careersUrl!.trim();
    const homeUrl = homepageUrlForDomain(domain);

    console.log("\n" + "=".repeat(88));
    console.log(`#${i + 1} companyId=${co.id} name=${co.name}`);
    console.log(`domain=${domain}`);
    console.log(`careersUrl=${careersUrl}`);

    const homeMeta = await fetchCareersHtmlWithMeta(homeUrl);
    const careersMeta = await fetchCareersHtmlWithMeta(careersUrl);

    console.log("\n--- Homepage ---");
    console.log(`url=${homeUrl}`);
    console.log(`fetched=${homeMeta.fetched} htmlLength=${homeMeta.htmlLength} err=${homeMeta.error ?? "none"}`);
    if (homeMeta.html) {
      console.log(`snippet1000=${JSON.stringify(snippet(homeMeta.html, 1000))}`);
      const hLinks = extractLinks(homeMeta.html, homeUrl);
      console.log(`extractLinks count=${hLinks.length}`);
      console.log(`links sample (max 40)=${JSON.stringify(hLinks.slice(0, 40))}`);
      const rawHrefs = extractAllLinkHrefs(homeMeta.html);
      console.log(`raw <a href> count unique=${rawHrefs.length}`);
    }

    console.log("\n--- Careers URL (stored) ---");
    console.log(`fetched=${careersMeta.fetched} htmlLength=${careersMeta.htmlLength} err=${careersMeta.error ?? "none"}`);
    if (careersMeta.html) {
      console.log(`snippet1000=${JSON.stringify(snippet(careersMeta.html, 1000))}`);
      const cLinks = extractLinks(careersMeta.html, careersUrl);
      console.log(`extractLinks count=${cLinks.length}`);
      console.log(`links sample (max 40)=${JSON.stringify(cLinks.slice(0, 40))}`);
    }

    let homeDiag: ReturnType<typeof diagnosePatterns> | null = null;
    let careersDiag: ReturnType<typeof diagnosePatterns> | null = null;
    if (homeMeta.html) {
      homeDiag = diagnosePatterns(homeMeta.html, extractLinks(homeMeta.html, homeUrl), homeUrl);
    }
    if (careersMeta.html) {
      careersDiag = diagnosePatterns(careersMeta.html, extractLinks(careersMeta.html, careersUrl), careersUrl);
    }

    const homeWin = homeDiag?.detectResult ?? { type: null, token: null };
    const careersWin = careersDiag?.detectResult ?? { type: null, token: null };
    const mergedType = (homeWin.type ?? careersWin.type) as AtsType | null;
    const mergedTokenQuick = homeWin.token ?? careersWin.token;

    console.log("\n--- Per-pattern (homepage) ---");
 if (homeDiag) {
      for (const p of homeDiag.patterns) {
        const reasons: string[] = [];
        if (!p.htmlMatch) reasons.push("no pattern in HTML");
        if (p.htmlMatch && !p.firstMatchingUrl) reasons.push("pattern in HTML but no matching URL in links/scripts/iframes");
        if (p.firstMatchingUrl && p.extractAtsTokenResult == null && ["greenhouse", "lever", "ashby"].includes(p.type))
          reasons.push(`URL hit but extractAtsToken returned null for ${p.type}`);
        if (p.type === "workday" && p.htmlMatch && p.extractAtsTokenResult == null)
          reasons.push("workday: extractAtsToken not implemented (token via extractWorkdayToken in enrich step)");
        console.log(
          JSON.stringify({
            ats: p.type,
            htmlMatch: p.htmlMatch,
            url: p.firstMatchingUrl,
            extractAtsToken: p.extractAtsTokenResult,
            notes: reasons,
          }),
        );
      }
      console.log(`detectATS homepage winner=${JSON.stringify(homeWin)}`);
    } else {
      console.log("(no homepage HTML)");
    }

    console.log("\n--- Per-pattern (careers page) ---");
    if (careersDiag) {
      for (const p of careersDiag.patterns) {
        const reasons: string[] = [];
        if (!p.htmlMatch) reasons.push("no pattern in HTML");
        if (p.htmlMatch && !p.firstMatchingUrl)
          reasons.push("pattern in HTML but no matching URL in links/scripts/iframes");
        if (p.firstMatchingUrl && p.extractAtsTokenResult == null && ["greenhouse", "lever", "ashby"].includes(p.type))
          reasons.push(`URL hit but extractAtsToken returned null`);
        if (p.type === "workday" && p.htmlMatch && p.extractAtsTokenResult == null)
          reasons.push("workday: extractAtsToken N/A; need extractWorkdayToken");
        console.log(
          JSON.stringify({
            ats: p.type,
            htmlMatch: p.htmlMatch,
            url: p.firstMatchingUrl,
            extractAtsToken: p.extractAtsTokenResult,
            notes: reasons,
          }),
        );
      }
      console.log(`detectATS careers winner=${JSON.stringify(careersWin)}`);
    } else {
      console.log("(no careers HTML)");
    }

    const combinedHtml = [homeMeta.html, careersMeta.html].filter(Boolean).join("\n");
    const tokenAfter = boardToken(mergedType, combinedHtml || null, careersUrl);

    console.log("\n--- Effective merge (as enrichment would use) ---");
    console.log(
      `merged detect type=${mergedType} quickTokenFromDetectATS=${mergedTokenQuick ?? "null"}`,
    );
    console.log(
      `extractBoardToken after winner=${tokenAfter ?? "null"} (greenhouse/lever/ashby/workday extractors)`,
    );
    if (mergedType === "workday" && careersUrl) {
      try {
        const u = new URL(careersUrl);
        console.log(
          JSON.stringify({
            workdayCareersHostname: u.hostname,
            pathSegments: u.pathname.split("/").filter(Boolean),
            parseWorkdayUrlWouldNeed: "tenant=subdomain, site=last path segment (see workday.extractor)",
          }),
        );
      } catch {
        console.log("workday URL parse failed (invalid careersUrl)");
      }
    }

    const letter = classifyFailure({
      homeMeta,
      careersMeta,
      homeDiag,
      careersDiag,
      detectWinner: mergedType,
      tokenAfterExtractors: tokenAfter,
    });
    bucket[letter] += 1;
    console.log(`\nheuristicBucket=${letter} (A=signal no win B=token C=no ATS D=fetch E=unused)`);
  }

  const total = companies.length || 1;
  console.log("\n" + "=".repeat(88));
  console.log("BUCKET COUNTS (heuristic, sample only):");
  console.log(JSON.stringify({ ...bucket, pct: {
    A: ((100 * bucket.A) / total).toFixed(1),
    B: ((100 * bucket.B) / total).toFixed(1),
    C: ((100 * bucket.C) / total).toFixed(1),
    D: ((100 * bucket.D) / total).toFixed(1),
    E: ((100 * bucket.E) / total).toFixed(1),
  } }, null, 2));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
