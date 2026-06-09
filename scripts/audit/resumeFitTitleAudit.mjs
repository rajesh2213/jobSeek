/**
 * Phase 5 title alignment validation audit.
 * Run: cd apps/client && npx tsx ../../scripts/audit/resumeFitTitleAudit.mjs
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toDetailJobItem } from "./lib/jobItemForAudit.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "apps/server/package.json"));
const { register } = await import("tsx/esm/api");
register();

const { PrismaClient } = require("@prisma/client");
const {
  computeTitleFit,
  deriveCandidateRoleFamily,
  deriveJobRoleFamily,
  isTitleFamilyMismatch,
} = await import(join(root, "apps/client/lib/resumeFitTitle.ts"));
const { scoreResume, clearScoreCache } = await import(join(root, "apps/client/lib/resumeScorer.ts"));

const prisma = new PrismaClient();
const SYNTHETIC_RESUME = `
Senior Backend Engineer with Python, TypeScript, React, SQL, Kubernetes experience.
`.trim();

const MISMATCH_CASES = [
  { candidate: "Backend Engineer", jobTitle: "Sales Engineer" },
  { candidate: "Senior Recruiter", jobTitle: "Customer Success Manager" },
  { candidate: "Product Manager", jobTitle: "Software Engineer" },
];

function mulberry32(seed) {
  return function rand() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function jobFromTitle(title, category = "engineering") {
  return {
    id: "manual",
    title,
    category,
    role: category,
    parsedDescription: {
      position: [],
      responsibility: [],
      requirement: [],
      experience: [],
      benefit: [],
      contact: [],
      other: [],
    },
  };
}

async function main() {
  clearScoreCache();
  const rand = mulberry32(505);

  const jobs = shuffle(
    await prisma.job.findMany({
      where: { isActive: true, isPublishable: true },
      select: {
        id: true,
        title: true,
        role: true,
        category: true,
        skills: true,
        description: true,
        parsedDescription: true,
        companyId: true,
      },
      take: 500,
      orderBy: { listingFreshnessAt: "desc" },
    }),
    rand,
  ).slice(0, 100);

  const users = shuffle(
    await prisma.user.findMany({
      where: { OR: [{ resumeText: { not: null } }, { resumeFileName: { not: null } }] },
      select: {
        yearsOfExperience: true,
        currentTitle: true,
        resumeStructuredV1: true,
        applyProfileSummary: true,
        resumeText: true,
      },
      take: 100,
      orderBy: { resumeUpdatedAt: "desc" },
    }),
    rand,
  ).slice(0, 100);

  let candidateCoverage = 0;
  let jobCoverage = 0;
  let titleFitPairs = 0;
  let familyMismatches = 0;
  const falseDetections = [];
  const beforeAfter = [];

  for (const row of jobs) {
    const job = toDetailJobItem(row);
    if (deriveJobRoleFamily(job).family != null) jobCoverage++;
  }

  for (const user of users) {
    const input = {
      currentTitle: user.currentTitle,
      resumeStructuredV1: user.resumeStructuredV1,
      applyProfileSummary: user.applyProfileSummary,
      resumeText: user.resumeText,
    };
    if (deriveCandidateRoleFamily(input).family != null) candidateCoverage++;
  }

  const t0 = performance.now();
  const latencies = [];
  for (const row of jobs.slice(0, 50)) {
    const job = toDetailJobItem(row);
    const t1 = performance.now();
    scoreResume(SYNTHETIC_RESUME, [], job, {}, {
      currentTitle: "Backend Engineer",
    });
    latencies.push(performance.now() - t1);
  }
  latencies.sort((a, b) => a - b);
  const p95Ms = latencies[Math.floor(latencies.length * 0.95)] ?? 0;

  for (let i = 0; i < Math.min(jobs.length, users.length); i++) {
    const job = toDetailJobItem(jobs[i]);
    const candidate = {
      currentTitle: users[i].currentTitle,
      resumeStructuredV1: users[i].resumeStructuredV1,
      applyProfileSummary: users[i].applyProfileSummary,
      resumeText: users[i].resumeText,
    };
    const fit = computeTitleFit(job, candidate);
    if (fit.titleFitScore != null && fit.candidateFamily && fit.jobFamily) {
      titleFitPairs++;
      if (isTitleFamilyMismatch(fit.candidateFamily, fit.jobFamily)) familyMismatches++;
    }
  }

  for (const spec of MISMATCH_CASES) {
    const j = jobFromTitle(
      spec.jobTitle,
      spec.jobTitle.includes("Success") ? "customer-support" : spec.jobTitle.includes("Sales") ? "sales" : "engineering",
    );
    const fit = computeTitleFit(j, { currentTitle: spec.candidate });
    const scored = scoreResume(SYNTHETIC_RESUME, [], j, {}, { currentTitle: spec.candidate });
    beforeAfter.push({
      case: `${spec.candidate} → ${spec.jobTitle}`,
      titleFit: fit.titleFitScore,
      finalScore: scored.score,
      availability: scored.matchAvailability,
      confidence: scored.confidenceLevel,
    });
    if (fit.titleFitScore !== 25) {
      falseDetections.push({
        case: `${spec.candidate} → ${spec.jobTitle}`,
        reason: "expected title fit 25",
        actual: fit.titleFitScore,
      });
    }
  }

  const candPct = users.length ? ((candidateCoverage / users.length) * 100).toFixed(1) : "0";
  const jobPct = jobs.length ? ((jobCoverage / jobs.length) * 100).toFixed(1) : "0";
  const fitPct =
    users.length && jobs.length
      ? (((titleFitPairs / Math.min(jobs.length, users.length)) * 100).toFixed(1))
      : "0";

  const report = {
    measuredAt: new Date().toISOString(),
    metrics: {
      candidateCoverage: `${candidateCoverage}/${users.length} (${candPct}%)`,
      jobCoverage: `${jobCoverage}/${jobs.length} (${jobPct}%)`,
      titleFitCoverage: `${titleFitPairs}/${Math.min(jobs.length, users.length)} (${fitPct}%)`,
      familyMismatches: `${familyMismatches}/${titleFitPairs || 0}`,
      falseDetections,
      p95ScoreMs: Math.round(p95Ms * 100) / 100,
    },
    beforeAfterSamples: beforeAfter,
    successCriteria: {
      titleFamilyCoverage80Pct: Number(candPct) >= 80 && Number(jobPct) >= 80,
      p95Under150ms: p95Ms < 150,
      mismatchCasesDetected: falseDetections.length === 0,
    },
    recommendation:
      Number(candPct) >= 80 && Number(jobPct) >= 80 && falseDetections.length === 0 && p95Ms < 150
        ? "GO"
        : "NO_GO",
  };

  const outPath = join(root, "scripts/audit/phase5-title-fit-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("\n=== Phase 5 Title Fit Audit ===\n");
  console.log(`Recommendation: ${report.recommendation}`);
  console.log(`Candidate coverage: ${report.metrics.candidateCoverage}`);
  console.log(`Job coverage: ${report.metrics.jobCoverage}`);
  console.log(`Title fit coverage: ${report.metrics.titleFitCoverage}`);
  console.log(`Family mismatches: ${report.metrics.familyMismatches}`);
  console.log(`P95 score ms: ${report.metrics.p95ScoreMs}`);
  console.log(`\nSaved: ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
