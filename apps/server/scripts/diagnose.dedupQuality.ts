/**
 * One-off DB diagnostics for dedup / job quality (run with DATABASE_URL set).
 * Usage: cd apps/server && npx tsx scripts/diagnose.dedupQuality.ts
 */
import { loadRootEnv } from "../src/infrastructure/env/loadEnv.js";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { CRAWLABLE_ATS_TYPES } from "../src/modules/ats/ats.interface.js";
import { normalizeTitleForFingerprint } from "../src/utils/jobFingerprint.js";
import { isSameJob } from "../src/utils/jobSimilarity.js";

loadRootEnv();

const ATS_SET = new Set<string>(CRAWLABLE_ATS_TYPES);

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(2)}%`;
}

function descLen(d: string | null | undefined): number {
  return (d ?? "").trim().length;
}

const GENERIC_TITLE_EXACT = new Set(
  [
    "careers",
    "career",
    "jobs",
    "job",
    "job role",
    "all jobs",
    "open positions",
    "open position",
    "opportunities",
    "opportunity",
    "current openings",
    "current opening",
    "join us",
    "work with us",
    "we are hiring",
    "hiring",
    "vacancies",
    "vacancy",
    "job openings",
    "job opening",
    "job listing",
    "listings",
    "roles",
    "open roles",
    "all open roles",
  ].map((s) => s.toLowerCase()),
);

function isGenericTitle(title: string): boolean {
  const t = title.trim().toLowerCase().replace(/\s+/g, " ");
  if (GENERIC_TITLE_EXACT.has(t)) return true;
  return /^(jobs at|careers at)\b/.test(t) || /^all open roles$/.test(t);
}

/** Heuristic: hub-ish /careers URL without obvious ATS job segment (not Greenhouse /o/). */
function isLikelyCareersPathWithoutJobId(url: string): boolean {
  const lower = url.toLowerCase();
  if (!lower.includes("/careers")) return false;
  if (/\/careers\/o\//.test(lower) || /\/careers\/p\//.test(lower)) return false;
  if (/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(url)) return false;
  return true;
}

type BucketJob = {
  id: string;
  title: string;
  description: string | null;
  companyId: string;
};

async function main(): Promise<void> {
  console.log("");
  console.log("======== DEDUP / INGESTION QUALITY DIAGNOSTICS ========");
  console.log("");
  console.log(
    "Note: in-process dedupRate = duplicate_merges / total_ingests (see jobMetrics.service.ts);",
  );
  console.log("      many first-seen rows become canonical_new → rate stays low until reposts overlap.");
  console.log("");

  const total = await prisma.job.count();
  const canonicalCount = await prisma.job.count({ where: { canonicalJobId: null } });
  const duplicateCount = await prisma.job.count({ where: { canonicalJobId: { not: null } } });

  console.log("Inventory:", { totalJobs: total, canonicalJobs: canonicalCount, duplicateRows: duplicateCount });
  console.log("");

  const descStats = await prisma.$queryRaw<Array<{ empty_desc: bigint; short_desc: bigint }>>`
    SELECT
      COUNT(*) FILTER (WHERE "description" IS NULL OR trim("description") = '')::bigint AS empty_desc,
      COUNT(*) FILTER (
        WHERE trim(coalesce("description", '')) <> ''
          AND length(trim("description")) < 120
      )::bigint AS short_desc
    FROM "Job"
  `;
  const emptyDesc = Number(descStats[0]?.empty_desc ?? 0);
  const shortDesc = Number(descStats[0]?.short_desc ?? 0);

  const genericTitles = await prisma.job
    .findMany({ select: { title: true } })
    .then((rows) => rows.filter((r) => isGenericTitle(r.title)).length);

  console.log("1) ALL JOB ROWS — description & title quality");
  console.log(`   empty/null description: ${emptyDesc} (${pct(emptyDesc, total)})`);
  console.log(`   description length < 120 (non-empty trimmed): ${shortDesc} (${pct(shortDesc, total)})`);
  console.log(`   generic-title heuristic: ${genericTitles} (${pct(genericTitles, total)})`);
  console.log("");

  const titleAgg = await prisma.job.groupBy({
    by: ["title"],
    where: { canonicalJobId: null },
    _count: { title: true },
    orderBy: { _count: { title: "desc" } },
    take: 20,
  });

  console.log("2) Top 20 most frequent titles (canonical jobs only, exact title string)");
  titleAgg.forEach((r, i) => {
    console.log(`   ${i + 1}. ${r._count.title}x — ${r.title.slice(0, 120)}`);
  });
  console.log("");

  const bySource = await prisma.job.groupBy({
    by: ["source"],
    _count: { source: true },
  });
  const sourceMap = new Map(bySource.map((x) => [x.source, x._count.source]));

  let crawlableAts = 0;
  let careersPage = 0;
  let other = 0;
  for (const [src, c] of sourceMap) {
    if (ATS_SET.has(src)) crawlableAts += c;
    else if (src === "careers_page") careersPage += c;
    else other += c;
  }

  console.log("3) Jobs by ingestion path (Job.source)");
  console.log(
    `   crawlable ATS (${CRAWLABLE_ATS_TYPES.join(", ")}): ${crawlableAts} (${pct(crawlableAts, total)})`,
  );
  console.log(`   careers_page (HTML link crawl): ${careersPage} (${pct(careersPage, total)})`);
  console.log(`   other (remoteok, wellfound, discovery seeds, etc.): ${other} (${pct(other, total)})`);
  console.log("   breakdown:");
  [...sourceMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([s, c]) => console.log(`      ${s}: ${c}`));
  console.log("");

  const hubTitleMatch = await prisma.job.findMany({
    where: {
      canonicalJobId: null,
      OR: [
        { title: { contains: "careers", mode: "insensitive" } },
        { title: { contains: "jobs", mode: "insensitive" } },
        { title: { contains: "opportunities", mode: "insensitive" } },
        { sourceUrl: { contains: "/careers", mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      title: true,
      sourceUrl: true,
      source: true,
      companyId: true,
      atsJobId: true,
      description: true,
    },
    take: 200,
    orderBy: { createdAt: "desc" },
  });

  const sample50 = hubTitleMatch
    .filter(
      (j) =>
        /careers|jobs|opportunities/i.test(j.title) ||
        isLikelyCareersPathWithoutJobId(j.sourceUrl),
    )
    .slice(0, 50);

  console.log("4) Sample up to 50 recent canonical jobs: title matches careers/jobs/opportunities OR /careers URL (hub heuristic)");
  sample50.forEach((j, i) => {
    const dlen = descLen(j.description);
    console.log(
      `   ${i + 1}. [${j.source}] descLen=${dlen} atsJobId=${j.atsJobId ?? "—"} title=${JSON.stringify(j.title.slice(0, 80))}`,
    );
    console.log(`      url=${j.sourceUrl.slice(0, 140)}`);
  });
  console.log("");

  console.log(
    "5) Pairwise isSameJob among canonical jobs with desc>120, bucket = companyId + normalizeTitleForFingerprint(title)",
  );
  const longDescCanon = await prisma.job.findMany({
    where: {
      canonicalJobId: null,
      AND: [{ description: { not: null } }, { NOT: { description: "" } } ],
    },
    select: { id: true, companyId: true, title: true, description: true },
  });
  const longJobs = longDescCanon.filter((j) => descLen(j.description) > 120);

  const buckets = new Map<string, BucketJob[]>();
  for (const j of longJobs) {
    const key = `${j.companyId}\t${normalizeTitleForFingerprint(j.title)}`;
    let arr = buckets.get(key);
    if (!arr) {
      arr = [];
      buckets.set(key, arr);
    }
    arr.push({
      id: j.id,
      title: j.title,
      description: j.description,
      companyId: j.companyId,
    });
  }

  const multi = [...buckets.entries()].filter(([, rows]) => rows.length >= 2);
  const MAX_JOBS_PER_BUCKET = 35;
  let totalPairs = 0;
  let passPairs = 0;
  for (const [, rows] of multi) {
    const slice = rows.length > MAX_JOBS_PER_BUCKET ? rows.slice(0, MAX_JOBS_PER_BUCKET) : rows;
    for (let i = 0; i < slice.length; i++) {
      for (let k = i + 1; k < slice.length; k++) {
        totalPairs += 1;
        if (
          isSameJob(
            { title: slice[i].title, description: slice[i].description },
            { title: slice[k].title, description: slice[k].description },
          )
        ) {
          passPairs += 1;
        }
      }
    }
  }

  console.log(`   canonical jobs with trimmed desc > 120: ${longJobs.length}`);
  console.log(`   buckets (company + norm title) with 2+ such jobs: ${multi.length}`);
  console.log(`   unordered pairs evaluated (capped ${MAX_JOBS_PER_BUCKET} jobs/bucket): ${totalPairs}`);
  console.log(`   pairs passing current isSameJob: ${passPairs} (${pct(passPairs, totalPairs)})`);
  console.log("");
  console.log("--- Interpretation sketch ---");
  console.log("A) Input quality: high empty/short/generic title % → merges blocked by strong-desc rule + noise.");
  console.log("B) Fragmentation: many pairs in same bucket but low pass % → descriptions/titles diverge (different roles or extraction noise).");
  console.log("C) Thresholds: many pairs narrowly failing stringSimilarity → consider inspecting distribution (not computed here).");
  console.log("");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
