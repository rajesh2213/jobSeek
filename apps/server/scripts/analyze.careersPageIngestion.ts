/**
 * Deep-dive: careers_page ingestion vs DB + live HTML (requires network).
 * Usage: cd apps/server && npx tsx scripts/analyze.careersPageIngestion.ts
 */
import { loadRootEnv } from "../src/infrastructure/env/loadEnv.js";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { CRAWLABLE_ATS_TYPES } from "../src/modules/ats/ats.interface.js";
import { fetchCareersHtmlWithMeta } from "../src/utils/fetchCareersHtml.js";

loadRootEnv();

function stripTags(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function metaDescription(html: string): string | null {
  const m = html.match(
    /<meta\s+[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["']/i,
  );
  if (m?.[1]) return m[1].trim();
  const m2 = html.match(
    /<meta\s+[^>]*content\s*=\s*["']([^"']*)["'][^>]*name\s*=\s*["']description["']/i,
  );
  return m2?.[1]?.trim() ?? null;
}

function jobPostingSnippet(html: string): string | null {
  const m = html.match(/"description"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (m?.[1]) return m[1].slice(0, 200).replace(/\\n/g, " ");
  return null;
}

/** URL buckets for reporting. */
export function classifyCareersUrl(url: string): "A" | "B" | "C" {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "C";
  }
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();
  const hay = `${host}${path}${u.search}`.toLowerCase();

  if (
    host.includes("sites.google.com") ||
    /signin|usernamerecovery|\/login|\/signup|oauth|callback/i.test(hay)
  ) {
    return "C";
  }

  const segments = u.pathname.split("/").filter(Boolean);
  const last = (segments[segments.length - 1] ?? "").replace(/\.aspx$/i, "");

  const hubTokens = new Set([
    "careers",
    "career",
    "jobs",
    "job",
    "openings",
    "opportunities",
    "vacancies",
    "teams-programs-offices",
    "search",
    "home",
  ]);

  if (path.includes("/categories/")) return "B";
  if (/\/career-area\/.+\/jobs\/?$/i.test(path)) return "B";
  if (path.match(/\/jobs\/?\?/)) return "B";
  if (segments.length <= 2 && hubTokens.has(last)) return "B";
  if (path.match(/^\/[^/]+\/careers\/?$/i)) return "B";
  if (path.match(/^\/careers\/?$/i)) return "B";
  if (path.match(/^\/jobs\/?$/i)) return "B";

  if (path.includes("/careers/") || path.includes("/jobs/")) {
    if (last.length >= 10 && /[a-z]-[a-z]/i.test(last)) return "A";
    if (last.length >= 8 && !hubTokens.has(last)) return "A";
  }

  if (/job|position|opening|apply|role/i.test(path)) return "A";

  return "B";
}

function isJobLikePathNotHomepage(url: string): boolean {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "") || "/";
    const segments = path.split("/").filter(Boolean);
    if (segments.length >= 3) return true;
    const last = segments[segments.length - 1] ?? "";
    if (/[a-z]-[a-z]{3,}/i.test(last) && !/^jobs?$/i.test(last)) return true;
    return false;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  console.log("\n=== careers_page pipeline (code) ===\n");
  console.log(
    "Source: jobSourceUrlIngestion.service.ts → fetchCareersHtml (hub only) + extractLinks (all <a href>) →",
  );
  console.log(
    "jobService.ingestDeduplicated({ title: extractTitleFromUrl(link), ... }) with NO description field.\n",
  );
  console.log(
    "There is no JD/body extractor for careers_page; empty description is expected from this path.\n",
  );

  const totalCareers = await prisma.job.count({ where: { source: "careers_page" } });
  const emptyCareers = await prisma.job.count({
    where: {
      source: "careers_page",
      OR: [{ description: null }, { description: "" }],
    },
  });

  const allCareers = await prisma.job.findMany({
    where: { source: "careers_page" },
    select: { sourceUrl: true, title: true, description: true },
  });

  let a = 0,
    b = 0,
    c = 0;
  for (const row of allCareers) {
    const k = classifyCareersUrl(row.sourceUrl);
    if (k === "A") a++;
    else if (k === "B") b++;
    else c++;
  }

  console.log("=== DB aggregate (careers_page) ===\n");
  console.log(`rows: ${totalCareers}`);
  console.log(`empty description: ${emptyCareers} (${((100 * emptyCareers) / totalCareers).toFixed(2)}%)`);
  console.log(`\nURL classification (heuristic on sourceUrl):`);
  console.log(`  A) real job-like pages: ${a} (${((100 * a) / totalCareers).toFixed(2)}%)`);
  console.log(`  B) listing/hub-like: ${b} (${((100 * b) / totalCareers).toFixed(2)}%)`);
  console.log(`  C) non-job / junk hosts: ${c} (${((100 * c) / totalCareers).toFixed(2)}%)`);
  console.log(
    `\n"Extraction failed" vs "not a job page": for careers_page, description is never set in code,`,
  );
  console.log(
    `so ${((100 * emptyCareers) / totalCareers).toFixed(2)}% empty = pipeline omission, not selector failure.`,
  );
  console.log(
    `Of rows classified A (job-like URL), empty description is still ~100% until a detail fetch+parse is added.\n`,
  );

  const jobLikeEmpty = allCareers.filter(
    (r) =>
      (!r.description || !r.description.trim()) &&
      isJobLikePathNotHomepage(r.sourceUrl) &&
      classifyCareersUrl(r.sourceUrl) !== "C",
  );

  console.log(
    `Empty-desc rows with path deeper than careers home & not junk host (sample pool): ${jobLikeEmpty.length}\n`,
  );

  const sample = jobLikeEmpty.slice(0, 20);
  console.log("=== Sample up to 20: live fetch (meta / stripped body hint / JSON-LD) ===\n");

  for (let i = 0; i < sample.length; i++) {
    const row = sample[i];
    const url = row.sourceUrl;
    console.log(`--- ${i + 1}. ${url}`);
    console.log(`    DB title: ${JSON.stringify(row.title.slice(0, 80))}`);

    const meta = await fetchCareersHtmlWithMeta(url);
    if (!meta.fetched || !meta.html) {
      console.log(`    fetch: FAILED — ${meta.error ?? "no html"}`);
      console.log(`    failureReason: network_or_http\n`);
      await sleep(250);
      continue;
    }

    const desc = metaDescription(meta.html);
    const stripped = stripTags(meta.html).slice(0, 420);
    const ld = jobPostingSnippet(meta.html);

    console.log(`    fetch: OK (${meta.htmlLength} chars)`);
    console.log(`    meta description: ${desc ? JSON.stringify(desc.slice(0, 200)) : "(none)"}`);
    console.log(`    stripped text prefix: ${JSON.stringify(stripped)}`);
    console.log(`    JSON-LD description hint: ${ld ? JSON.stringify(ld) : "(none)"}`);
    console.log(
      `    what ingest returned for description: (omitted — ingestDeduplicated not passed description)`,
    );
    console.log(
      `    failureReason: no_description_field_in_careers_page_ingest (not DOM selector extraction)`,
    );
    console.log(
      `    note: if stripped text is empty/minimal, page may be CSR-only — check separately\n`,
    );
    await sleep(400);
  }

  console.log("=== ATS sources (crawlable) empty description ===\n");
  for (const src of CRAWLABLE_ATS_TYPES) {
    const tot = await prisma.job.count({ where: { source: src } });
    if (tot === 0) continue;
    const empty = await prisma.job.count({
      where: {
        source: src,
        OR: [{ description: null }, { description: "" }],
      },
    });
    console.log(
      `${src}: ${empty}/${tot} empty (${((100 * empty) / tot).toFixed(2)}%)`,
    );
  }

  await prisma.$disconnect();
  console.log("\nDone.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
