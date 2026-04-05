/**
 * Measurement-only analysis for ATS ingestion/detection pipeline.
 *
 * Output focuses on:
 *  - DB ATS coverage counts (and crawlable subset)
 *  - Where ATS companies come from (discoverySource + enrichment detection logs where available)
 *  - Token presence + whether crawler ran in logs
 *  - Enrichment throughput and ATS detections over time from logs (last 30 min window)
 *
 * Usage:
 *   cd apps/server
 *   npx tsx scripts/analyze.atsPipelineMeasurements.ts
 */
import fs from "node:fs";
import path from "node:path";
import { loadRootEnv } from "../src/infrastructure/env/loadEnv.js";
import { prisma } from "../src/infrastructure/db/prisma.js";
import type { Company } from "@prisma/client";

type LogLine = {
  level?: number;
  time?: number;
  event?: string;
  msg?: string;
  companyId?: string;
  atsType?: string | null;
  source?: string;
  ats_detected?: string;
  [key: string]: unknown;
};

const ENRICH_LOG = "jobseek-worker-enrich-20260326.log";
const JOB_LOG = "jobseek-worker-job-20260326.log";

const CRAWLABLE_ATS = new Set(["greenhouse", "lever", "ashby", "workday"]);

function pct(n: number, d: number): string {
  if (d === 0) return "n/a";
  return `${((100 * n) / d).toFixed(2)}%`;
}

function toMinuteBucket(epochMs: number): number {
  return Math.floor(epochMs / 60_000);
}

function safeParseJsonLine(line: string): LogLine | null {
  try {
    return JSON.parse(line) as LogLine;
  } catch {
    return null;
  }
}

function readJsonLinesSync(filePath: string): LogLine[] {
  const full = fs.readFileSync(filePath, "utf8");
  const lines = full.split(/\r?\n/);
  const out: LogLine[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const parsed = safeParseJsonLine(line);
    if (parsed) out.push(parsed);
  }
  return out;
}

function classifyDiscoverySource(ds: string | null | undefined): "seed_dataset" | "job_ingestion" | "enrichment_other" {
  const v = ds ?? "";
  if (v.includes("job_ingestion")) return "job_ingestion";
  if (!v || v.includes("api_manual")) return "seed_dataset";
  return "enrichment_other";
}

function parseWorkdayTokenJson(token: string | null | undefined): boolean {
  if (!token?.trim()) return false;
  try {
    const obj = JSON.parse(token) as { host?: string; tenant?: string; site?: string };
    return Boolean(obj.host?.trim() && obj.tenant?.trim() && obj.site?.trim());
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  loadRootEnv();

  const totalCompanies = await prisma.company.count();

  const companiesWithAts = await prisma.company.count({ where: { atsType: { not: null } } });

  const atsBreakdown = await prisma.company.groupBy({
    by: ["atsType"],
    where: { atsType: { not: null } },
    _count: { atsType: true },
  });

  const crawlableBreakdown = await prisma.company.count({
    where: {
      atsType: { in: ["greenhouse", "lever", "ashby", "workday"] as unknown as AtsType[] },
    },
  });

  console.log("\n=== PART 1 — ATS SOURCE OF TRUTH (DB) ===");
  console.log(JSON.stringify({
    totalCompanies,
    companiesWithAts,
    atsDetectionPct: pct(companiesWithAts, totalCompanies),
    crawlableAtsCompanies: crawlableBreakdown,
    crawlableAtsPctOfAll: pct(crawlableBreakdown, totalCompanies),
    atsTypeBreakdown: atsBreakdown.map((r) => ({ atsType: r.atsType, companies: r._count.atsType })),
  }, null, 2));

  // Scripts are usually run with cwd = apps/server.
  // Use cwd-based path resolution to avoid URL->filesystem path quirks on Windows.
  const logsDir = path.resolve(process.cwd(), "logs");
  const enrichLogPath = path.join(logsDir, ENRICH_LOG);
  const jobLogPath = path.join(logsDir, JOB_LOG);

  const enrichLines = fs.existsSync(enrichLogPath) ? readJsonLinesSync(enrichLogPath) : [];
  const jobLines = fs.existsSync(jobLogPath) ? readJsonLinesSync(jobLogPath) : [];

  const maxTime = enrichLines.reduce((acc, l) => (typeof l.time === "number" ? Math.max(acc, l.time) : acc), 0);
  const windowMs = 30 * 60_000;
  const windowStart = maxTime > 0 ? maxTime - windowMs : 0;

  const enrichWindow = maxTime > 0 ? enrichLines.filter((l) => typeof l.time === "number" && l.time >= windowStart) : [];

  // Full enrich log (not the 30m window) — needed so detection source is available for all ATS companies.
  const atsDetectedByCompany = new Map<
    string,
    { atsType: string | null; source: string | null; time: number }
  >();
  for (const l of enrichLines) {
    if (l.event !== "ats_detected") continue;
    const cid = l.companyId;
    const t = typeof l.time === "number" ? l.time : 0;
    if (!cid || !t) continue;
    const atsType = typeof l.atsType === "string" ? l.atsType : null;
    const src = typeof l.source === "string" ? l.source : null;
    const prev = atsDetectedByCompany.get(cid);
    if (!prev || t > prev.time) {
      atsDetectedByCompany.set(cid, { atsType, source: src, time: t });
    }
  }

  console.log("\n=== PART 2 — WHERE ARE ATS COMPANIES COMING FROM? ===");

  const atsCompanies = await prisma.company.findMany({
    where: { atsType: { not: null } },
    select: {
      id: true,
      domain: true,
      careersUrl: true,
      atsType: true,
      atsBoardToken: true,
      discoverySource: true,
    },
  });

  const discoveryCounts = { seed_dataset: 0, job_ingestion: 0, enrichment_other: 0 } as Record<string, number>;
  for (const c of atsCompanies) {
    const k = classifyDiscoverySource(c.discoverySource);
    discoveryCounts[k] += 1;
  }

  console.log("DiscoverySource classification counts (DB; all ATS companies):");
  console.log(JSON.stringify(discoveryCounts, null, 2));

  const detectionSourceCounts = { homepage: 0, careers: 0, unknown_missing_logs: 0 } as Record<string, number>;
  for (const c of atsCompanies) {
    const det = atsDetectedByCompany.get(c.id);
    if (!det) {
      detectionSourceCounts.unknown_missing_logs += 1;
      continue;
    }
    if (det.source === "homepage") detectionSourceCounts.homepage += 1;
    else if (det.source === "careers") detectionSourceCounts.careers += 1;
    else detectionSourceCounts.unknown_missing_logs += 1;
  }
  console.log("ATS detection source counts (from enrich logs; subset in last 30 min):");
  console.log(JSON.stringify(detectionSourceCounts, null, 2));

  const sample10 = atsCompanies
    .slice(0, 10)
    .map((c) => {
      const det = atsDetectedByCompany.get(c.id);
      return {
        companyId: c.id,
        domain: c.domain,
        careersUrl: c.careersUrl,
        atsType: c.atsType,
        detectionSource: det ? det.source : null,
        detectionLogTime: det ? det.time : null,
      };
    });
  console.log("Sample 10 ATS companies (DB + detection source from enrich logs if present):");
  console.log(JSON.stringify(sample10, null, 2));

  console.log("\n=== PART 3 — ATS ENDPOINT EXTRACTION QUALITY ===");

  const tokenStats = { hasToken: 0, missingToken: 0, validWorkdayToken: 0, invalidWorkdayToken: 0 } as Record<string, number>;
  let supportedTokenMissing = 0;
  let supportedTokenPresent = 0;
  for (const c of atsCompanies) {
    const atsType = c.atsType;
    const tokenOk = Boolean(c.atsBoardToken?.trim());
    if (tokenOk) tokenStats.hasToken += 1;
    else tokenStats.missingToken += 1;

    const supported = CRAWLABLE_ATS.has(atsType as any);
    if (supported) {
      if (tokenOk) supportedTokenPresent += 1;
      else supportedTokenMissing += 1;
    }

    if (atsType === "workday") {
      const valid = parseWorkdayTokenJson(c.atsBoardToken ?? null);
      if (valid) tokenStats.validWorkdayToken += 1;
      else tokenStats.invalidWorkdayToken += 1;
    }
  }

  const crawlStartCompanies = new Set<string>();
  const jobsParsedCompanies = new Map<string, number>();
  for (const l of jobLines) {
    if (l.event === "crawl_start" && typeof l.companyId === "string") {
      crawlStartCompanies.add(l.companyId);
    }
    if (l.event === "jobs_parsed" && typeof l.companyId === "string" && typeof l.count === "number") {
      jobsParsedCompanies.set(l.companyId, l.count);
    }
  }

  const crawlerStats = { crawlStartSeen: 0, jobsParsedSeen: 0, crawlerRanWithAnyJobs: 0 } as Record<string, number>;
  const crawlerStatsUnsupported = { crawlStartSeen: 0, jobsParsedSeen: 0 } as Record<string, number>;
  const atsSupportedCount = atsCompanies.filter((c) => CRAWLABLE_ATS.has(c.atsType as any)).length;
  const atsUnsupportedCount = atsCompanies.length - atsSupportedCount;
  for (const c of atsCompanies) {
    const cid = c.id;
    const supported = CRAWLABLE_ATS.has(c.atsType as any);
    if (crawlStartCompanies.has(cid)) {
      if (supported) crawlerStats.crawlStartSeen += 1;
      else crawlerStatsUnsupported.crawlStartSeen += 1;
    }
    if (jobsParsedCompanies.has(cid)) {
      if (supported) crawlerStats.jobsParsedSeen += 1;
      else crawlerStatsUnsupported.jobsParsedSeen += 1;
    }
    const parsedCount = jobsParsedCompanies.get(cid);
    if (supported && typeof parsedCount === "number" && parsedCount >= 1) crawlerStats.crawlerRanWithAnyJobs += 1;
  }

  console.log("Token presence stats (DB; token field included if present in Company rows):");
  console.log(JSON.stringify({
    hasToken: tokenStats.hasToken,
    missingToken: tokenStats.missingToken,
    hasTokenPct: pct(tokenStats.hasToken, atsCompanies.length),
    workdayValidToken: tokenStats.validWorkdayToken,
    workdayInvalidToken: tokenStats.invalidWorkdayToken,
    supportedTokenPresent,
    supportedTokenMissing,
  }, null, 2));

  console.log("Crawler run presence stats (from job log file only; not global):");
  console.log(JSON.stringify({
    crawlStartSeen: crawlerStats.crawlStartSeen,
    jobsParsedSeen: crawlerStats.jobsParsedSeen,
    crawlerRanWithAnyJobs: crawlerStats.crawlerRanWithAnyJobs,
    crawlStartSeenPct: pct(crawlerStats.crawlStartSeen, atsCompanies.length),
    atsSupportedCount,
    atsUnsupportedCount,
    crawlStartSeenUnsupported: crawlerStatsUnsupported.crawlStartSeen,
  }, null, 2));

  console.log("\n=== PART 4 — WORKER THROUGHPUT ANALYSIS (last 30 min from enrich log max timestamp) ===");

  const startTimes = new Map<string, number>();
  const durations: number[] = [];
  let started = 0;
  let completed = 0;
  let completedAts = 0;
  let noAts = 0;
  for (const l of enrichWindow) {
    if (l.event === "company_enrichment_started" && typeof l.companyId === "string") {
      started += 1;
      if (typeof l.time === "number") startTimes.set(l.companyId, l.time);
    }
    if (l.event === "enrichment_complete" && typeof l.companyId === "string") {
      completed += 1;
      const atsType = typeof l.atsType === "string" ? l.atsType : null;
      if (atsType) completedAts += 1;
      const st = startTimes.get(l.companyId);
      if (typeof l.time === "number" && typeof st === "number") durations.push(l.time - st);
    }
    if (l.event === "no_ats_detected" && typeof l.companyId === "string") {
      noAts += 1;
    }
  }

  const avgEnrichmentMs = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

  const detectionsPerMinute = new Map<number, number>();
  const detectionSourceMinutes = { homepage: new Map<number, number>(), careers: new Map<number, number>() } as any;
  for (const l of enrichWindow) {
    if (l.event !== "ats_detected") continue;
    if (typeof l.time !== "number") continue;
    const bucket = toMinuteBucket(l.time);
    detectionsPerMinute.set(bucket, (detectionsPerMinute.get(bucket) ?? 0) + 1);
    const src = typeof l.source === "string" ? l.source : null;
    if (src === "homepage") detectionSourceMinutes.homepage.set(bucket, (detectionSourceMinutes.homepage.get(bucket) ?? 0) + 1);
    if (src === "careers") detectionSourceMinutes.careers.set(bucket, (detectionSourceMinutes.careers.get(bucket) ?? 0) + 1);
  }

  const detectionCount = Array.from(detectionsPerMinute.values()).reduce((a, b) => a + b, 0);
  const bucketsSorted = [...detectionsPerMinute.entries()].sort((a, b) => a[0] - b[0]);

  const firstBuckets = bucketsSorted.slice(0, 10).map(([bucket, count]) => ({ bucketMinute: bucket, count }));
  const lastBuckets = bucketsSorted.slice(-10).map(([bucket, count]) => ({ bucketMinute: bucket, count }));

  let trend: "increasing" | "flat" | "saturating_early" = "flat";
  if (bucketsSorted.length >= 6) {
    const headN = Math.min(5, bucketsSorted.length);
    const tailN = Math.min(5, bucketsSorted.length);
    const headAvg =
      bucketsSorted.slice(0, headN).reduce((a, [, c]) => a + c, 0) / Math.max(1, headN);
    const tailAvg =
      bucketsSorted.slice(-tailN).reduce((a, [, c]) => a + c, 0) / Math.max(1, tailN);
    // crude but deterministic trend detection for measurement-only reporting
    if (tailAvg > headAvg * 1.2) trend = "increasing";
    else if (tailAvg < headAvg * 0.8) trend = "saturating_early";
    else trend = "flat";
  }

  console.log("Window computations:");
  console.log(JSON.stringify({
    enrichLogMaxTime: maxTime || null,
    windowStart,
    windowMinutes: maxTime > 0 ? 30 : null,
    companiesEnrichmentStarted: started,
    companiesEnrichmentCompleted: completed,
    companiesCompletedWithAtsType: completedAts,
    enrichCompleteAtsPct: pct(completedAts, completed),
    noAtsDetectedEvents: noAts,
    avgEnrichmentMs: durations.length ? avgEnrichmentMs : null,
    companiesProcessedIn30MinPctOfAll: pct(completed, totalCompanies),
    atsDetectedEventsIn30Min: detectionCount,
    atsDetectionTrendOverTime: trend,
    detectionBucketsFirst10: firstBuckets,
    detectionBucketsLast10: lastBuckets,
  }, null, 2));

  const logicVsTime = completedAts;
  const fractionProcessed = completed / Math.max(1, totalCompanies);

  let classification: "ALREADY_WORKING" | "PARTIALLY_WORKING" | "NOT_WORKING";
  // Classification rule: if we see high % of processed jobs get ats_detected / crawl_start within window, logic works and time is main constraint.
  // Otherwise, classify as logic-limited. (Only based on measured window data.)
  if (fractionProcessed < 0.01) {
    classification = "PARTIALLY_WORKING";
  } else {
    classification = completedAts > 0 ? "ALREADY_WORKING" : "NOT_WORKING";
  }

  console.log("\n=== PART 7 — FINAL CLASSIFICATION (based on measured throughput in last 30 min) ===");
  console.log(JSON.stringify({
    fractionCompaniesCompletedIn30Min: fractionProcessed,
    atsDetectedEventsIn30Min: detectionCount,
    classification,
    measurementBasis: {
      companiesProcessedIn30Min: completed,
      companiesCompletedWithAtsType: completedAts,
      totalCompanies,
    },
  }, null, 2));

  // If no logs available
  if (!enrichLines.length) {
    console.log("\nWARNING: Enrichment log file missing or empty; log-based measurements are unavailable.");
  }
  if (!jobLines.length) {
    console.log("\nWARNING: Job log file missing or empty; crawler-run measurements from logs are unavailable.");
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

