#!/usr/bin/env node
/**
 * Production SEO audit — read-only checks against live site + local policy classification.
 * Usage: node deploy/scripts/seo-production-audit.mjs
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://www.jobloom.tech";
const UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

const __dir = dirname(fileURLToPath(import.meta.url));

async function fetchText(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, ...opts.headers },
    redirect: opts.followRedirect === false ? "manual" : "follow",
    signal: AbortSignal.timeout(opts.timeoutMs ?? 25000),
  });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

function parseRobots(html) {
  const m = html.match(/<meta name="robots" content="([^"]+)"/i);
  return m?.[1] ?? null;
}

function parseJobPosting(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  for (const [, raw] of blocks) {
    try {
      const d = JSON.parse(raw);
      if (d["@type"] === "JobPosting") return d;
    } catch {
      /* skip */
    }
  }
  return null;
}

async function main() {
  console.log("=== JobLoom production SEO audit ===\n");

  // ── Sitemap ──
  const sm = await fetchText(`${BASE}/sitemap.xml`);
  const urls = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const byType = { job: 0, company: 0, skill: 0, skillLoc: 0, catLoc: 0, role: 0, other: 0 };
  for (const u of urls) {
    if (/\/job\//.test(u)) byType.job++;
    else if (/\/company\//.test(u)) byType.company++;
    else if (/\/jobs\/skill\/[^/]+\/location\//.test(u)) byType.skillLoc++;
    else if (/\/jobs\/skill\//.test(u)) byType.skill++;
    else if (/\/jobs\/category\/[^/]+\/location\//.test(u)) byType.catLoc++;
    else if (/\/jobs\/role\//.test(u)) byType.role++;
    else byType.other++;
  }
  console.log("Sitemap URLs:", urls.length, byType);

  // ── Step 1: noindex pattern audit (live robots meta) ──
  const noindexPatterns = [
    { label: "skill hub (canonical)", url: `${BASE}/jobs/skill/typescript`, expectIndex: true },
    { label: "category hub", url: `${BASE}/jobs/category/engineering`, expectIndex: true },
    { label: "duplicate query (should 308)", url: `${BASE}/jobs/skill/typescript?skills=typescript`, expectRedirect: true },
    { label: "pagination page=2", url: `${BASE}/jobs/skill/typescript?page=2`, expectIndex: false },
    { label: "posted refinement", url: `${BASE}/jobs/skill/typescript?posted=24h`, expectIndex: false },
    { label: "experience slug", url: `${BASE}/jobs/role/data-engineer/experience/0-2-years`, expectIndex: true },
    { label: "companies directory", url: `${BASE}/companies`, expectIndex: true },
    { label: "browse page", url: `${BASE}/jobs/browse`, expectIndex: true },
  ];

  console.log("\n--- Step 1: noindex / redirect audit ---");
  const noindexFindings = [];
  for (const p of noindexPatterns) {
    const r = await fetchText(p.url, { followRedirect: p.expectRedirect ? false : true });
    const loc = r.headers.get("location");
    if (p.expectRedirect) {
      const ok = r.status === 308 || r.status === 301 || r.status === 307;
      console.log(`${ok ? "PASS" : "FAIL"} ${p.label}: HTTP ${r.status} location=${loc ?? "—"}`);
      if (!ok) noindexFindings.push(p.label);
      continue;
    }
    const robots = parseRobots(r.body);
    const indexed = robots?.includes("index") && !robots?.includes("noindex");
    const ok = p.expectIndex ? indexed : !indexed;
    console.log(`${ok ? "PASS" : "WARN"} ${p.label}: robots="${robots ?? "missing"}"`);
    if (!ok) noindexFindings.push(`${p.label} robots=${robots}`);
  }

  // Sample sitemap landing URLs for accidental noindex
  const landingSamples = urls
    .filter((u) => u.includes("/jobs/") && !u.endsWith("/jobs"))
    .filter((u) => !u.includes("/job/"))
    .slice(0, 15);
  let landingNoindex = 0;
  for (const u of landingSamples) {
    const r = await fetchText(u);
    const robots = parseRobots(r.body);
    if (robots?.includes("noindex")) {
      landingNoindex++;
      console.log("WARN sitemap landing noindex:", u, robots);
    }
  }
  console.log(`Landing sample: ${landingSamples.length} checked, ${landingNoindex} with noindex`);

  // ── Step 2: Job Posting JSON-LD audit ──
  console.log("\n--- Step 2: Job Posting JSON-LD (sample) ---");
  const jobUrls = urls.filter((u) => u.includes("/job/")).slice(0, 40);
  let withLd = 0;
  let withDatePosted = 0;
  let withBaseSalary = 0;
  let withAddressLocality = 0;
  for (const u of jobUrls) {
    const r = await fetchText(u);
    const ld = parseJobPosting(r.body);
    if (!ld) continue;
    withLd++;
    if (ld.datePosted) withDatePosted++;
    if (ld.baseSalary) withBaseSalary++;
    const addr = ld.jobLocation?.address;
    if (addr?.addressLocality) withAddressLocality++;
  }
  console.log(`Jobs sampled: ${jobUrls.length}`);
  console.log(`  JobPosting JSON-LD: ${withLd}`);
  console.log(`  with datePosted: ${withDatePosted}`);
  console.log(`  with baseSalary: ${withBaseSalary}`);
  console.log(`  with addressLocality: ${withAddressLocality}`);
  console.log(`  emit rate: ${((withLd / jobUrls.length) * 100).toFixed(1)}%`);

  // ── Step 3: duplicate canonical redirects ──
  console.log("\n--- Step 3: duplicate canonical redirects ---");
  const dupTests = [
    `${BASE}/jobs/category/engineering?category=engineering`,
    `${BASE}/jobs?skills=python`,
  ];
  for (const u of dupTests) {
    const r = await fetchText(u, { followRedirect: false });
    console.log(`HTTP ${r.status} → ${r.headers.get("location") ?? "—"}  (${u.replace(BASE, "")})`);
  }

  console.log("\n--- Summary ---");
  console.log("Pattern failures:", noindexFindings.length ? noindexFindings : "none");
  console.log("Sitemap landing accidental noindex:", landingNoindex);
  console.log("JobPosting emit rate:", `${withLd}/${jobUrls.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
