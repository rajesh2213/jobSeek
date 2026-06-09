/**
 * Phase 2.1: List payload size audit (full vs slim parsedDescription).
 * Run: npx tsx scripts/audit/resumeMatchPayloadAudit.mjs
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { slimParsed, stripHtml, buildPreviewLines } from "./lib/jobItemForAudit.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "apps/server/package.json"));
const { PrismaClient } = require("@prisma/client");

const SAMPLE = 500;
const JOBS_PER_PAGE = 50;
const prisma = new PrismaClient();

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function listPayloadBytes(row) {
  const preview = buildPreviewLines(row);
  const base = {
    id: row.id,
    title: row.title,
    role: row.role ?? "",
    skills: row.skills ?? [],
    description: preview.length >= 40 ? null : stripHtml(row.description ?? "").slice(0, 1200),
    previewLines: preview,
    previewLinesSource: "requirement",
    company: { id: row.companyId, name: row.company?.name ?? "x", slug: "x", logoUrl: null },
    freshness: { source: "POSTED", timestamp: row.postedAt?.toISOString?.() ?? null },
  };
  const withFullParsed = { ...base, parsedDescription: row.parsedDescription ?? null };
  const withSlimParsed = { ...base, parsedDescription: slimParsed(row.parsedDescription) };
  return {
    base: Buffer.byteLength(JSON.stringify(base), "utf8"),
    full: Buffer.byteLength(JSON.stringify(withFullParsed), "utf8"),
    slim: Buffer.byteLength(JSON.stringify(withSlimParsed), "utf8"),
    parsedFull: Buffer.byteLength(JSON.stringify(row.parsedDescription ?? null), "utf8"),
    parsedSlim: Buffer.byteLength(JSON.stringify(slimParsed(row.parsedDescription)), "utf8"),
  };
}

async function main() {
  const rows = await prisma.job.findMany({
    where: { isActive: true, isPublishable: true },
    select: {
      id: true,
      title: true,
      role: true,
      skills: true,
      description: true,
      parsedDescription: true,
      companyId: true,
      postedAt: true,
      company: { select: { name: true } },
    },
    take: SAMPLE,
    orderBy: { listingFreshnessAt: "desc" },
  });

  const parsedSizes = [];
  const perJobFull = [];
  const perJobSlim = [];
  const perJobBase = [];

  for (const row of rows) {
    const m = listPayloadBytes(row);
    parsedSizes.push(m.parsedFull);
    perJobFull.push(m.full);
    perJobSlim.push(m.slim);
    perJobBase.push(m.base);
  }

  const sortedParsed = [...parsedSizes].sort((a, b) => a - b);
  const avg = (arr) => Math.round(arr.reduce((a, b) => a + b, 0) / Math.max(arr.length, 1));
  const avgFullPerJob = avg(perJobFull);
  const avgSlimPerJob = avg(perJobSlim);
  const avgBasePerJob = avg(perJobBase);
  const fullPageKb = Math.round((avgFullPerJob * JOBS_PER_PAGE) / 1024);
  const slimPageKb = Math.round((avgSlimPerJob * JOBS_PER_PAGE) / 1024);
  const basePageKb = Math.round((avgBasePerJob * JOBS_PER_PAGE) / 1024);
  const extraFullKb = fullPageKb - basePageKb;
  const extraSlimKb = slimPageKb - basePageKb;

  const report = {
    measuredAt: new Date().toISOString(),
    sampleSize: rows.length,
    jobsPerPage: JOBS_PER_PAGE,
    avgParsedDescriptionBytes: avg(parsedSizes),
    p50ParsedDescriptionBytes: percentile(sortedParsed, 50),
    p95ParsedDescriptionBytes: percentile(sortedParsed, 95),
    avgBasePayloadPerJobBytes: avgBasePerJob,
    avgFullPayloadPerJobBytes: avgFullPerJob,
    avgSlimPayloadPerJobBytes: avgSlimPerJob,
    estimated50JobPageBaseKb: basePageKb,
    estimated50JobPageFullKb: fullPageKb,
    estimated50JobPageSlimKb: slimPageKb,
    fullParsedExtraKbPerPage: extraFullKb,
    slimParsedExtraKbPerPage: extraSlimKb,
    fullParsedKbPerPage: extraFullKb,
    slimParsedKbPerPage: extraSlimKb,
    savingsPct: extraFullKb > 0 ? Math.round(((extraFullKb - extraSlimKb) / extraFullKb) * 100) : 0,
    note: "description remains null when previewLines exist (unchanged). parsedDescription is the egress delta.",
  };

  const outPath = join(root, "scripts/audit/resumeMatchPayloadAudit.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("\n=== Resume Match Payload Audit ===\n");
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nSaved: ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
