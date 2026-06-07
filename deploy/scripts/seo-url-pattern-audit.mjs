#!/usr/bin/env node
/**
 * Classify SEO landing URL patterns for GSC "Crawled – not indexed" triage.
 * Usage:
 *   node deploy/scripts/seo-url-pattern-audit.mjs
 *   node deploy/scripts/seo-url-pattern-audit.mjs path/to/gsc-export.csv
 *
 * Without a CSV, audits live sitemap URLs only.
 */
import { readFileSync } from "node:fs";

const BASE = "https://www.jobloom.tech";

function classifyPath(pathname) {
  const p = pathname.replace(/^\/+/, "");
  if (p.startsWith("job/")) return "job_detail";
  if (p.startsWith("company/")) return "company";
  if (p === "jobs" || p === "jobs/") return "jobs_root";
  if (p.startsWith("jobs/skill/") && p.includes("/location/")) return "skill_location";
  if (p.startsWith("jobs/skill/")) return "skill_hub";
  if (p.startsWith("jobs/category/") && p.includes("/location/")) return "category_location";
  if (p.startsWith("jobs/category/")) return "category_hub";
  if (p.startsWith("jobs/role/") && p.includes("/location/") && p.includes("/experience/")) {
    return "role_location_experience";
  }
  if (p.startsWith("jobs/role/") && p.includes("/experience/")) return "role_experience";
  if (p.startsWith("jobs/role/") && p.includes("/location/")) return "role_location";
  if (p.startsWith("jobs/role/")) return "role_hub";
  if (p.startsWith("jobs/location/")) return "location_hub";
  if (p.startsWith("jobs/browse")) return "browse";
  return "other";
}

function bucketUrls(urls) {
  const buckets = new Map();
  for (const raw of urls) {
    let pathname = raw.trim();
    if (!pathname) continue;
    try {
      if (pathname.startsWith("http")) pathname = new URL(pathname).pathname;
    } catch {
      /* keep raw */
    }
    const key = classifyPath(pathname);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return buckets;
}

function parseCsvUrls(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const header = lines[0].toLowerCase();
  const urlIdx = header.includes("url") ? header.split(",").findIndex((h) => h.includes("url")) : 0;
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const cell = cols[urlIdx >= 0 ? urlIdx : 0]?.trim().replace(/^"|"$/g, "");
    if (cell) out.push(cell);
  }
  return out;
}

async function fetchSitemapUrls() {
  const res = await fetch(`${BASE}/sitemap.xml`, {
    headers: { "User-Agent": "JobLoom-SEO-Audit/1.0" },
    signal: AbortSignal.timeout(25000),
  });
  const body = await res.text();
  return [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

function printBuckets(label, buckets) {
  console.log(`\n--- ${label} ---`);
  const sorted = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
  let total = 0;
  for (const [k, v] of sorted) {
    total += v;
    console.log(`${String(v).padStart(5)}  ${k}`);
  }
  console.log(`${String(total).padStart(5)}  TOTAL`);
  console.log("\nTier-1 focus: role_location, role_location_experience, role_experience");
}

async function main() {
  const csvPath = process.argv[2];
  if (csvPath) {
    const text = readFileSync(csvPath, "utf8");
    const urls = parseCsvUrls(text);
    printBuckets(`GSC export (${csvPath})`, bucketUrls(urls));
    return;
  }

  console.log("=== SEO URL pattern audit (live sitemap) ===");
  const urls = await fetchSitemapUrls();
  printBuckets("Sitemap URLs", bucketUrls(urls));
  console.log("\nTip: export GSC 'Crawled – currently not indexed' URLs and re-run:");
  console.log("  node deploy/scripts/seo-url-pattern-audit.mjs gsc-crawled-not-indexed.csv");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
