/**
 * Phase 4 seniority fit validation audit.
 * Run: cd apps/client && npx tsx ../../scripts/audit/resumeFitSeniorityAudit.mjs
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toDetailJobItem } from "./lib/jobItemForAudit.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "apps/server/package.json"));
const { register } = await import("tsx/esm/api");
register();

const { PrismaClient } = require("@prisma/client");
const {
  applySeniorityGapCap,
  blendResumeFitScore,
  computeSeniorityFit,
  deriveCandidateSeniority,
  deriveJobSeniority,
} = await import(join(root, "apps/client/lib/resumeFitSeniority.ts"));
const {
  applyExperienceGapCap,
  computeExperienceFit,
} = await import(join(root, "apps/client/lib/resumeFitExperience.ts"));
const { scoreResume, clearScoreCache, candidateExperienceFromApplyProfile } = await import(
  join(root, "apps/client/lib/resumeScorer.ts"),
);

const prisma = new PrismaClient();
const JOB_SAMPLE = 100;
const RESUME_SAMPLE = 100;
const SYNTHETIC_RESUME =
  "Python SQL TypeScript React Kubernetes agile scrum 6 years experience senior engineer";

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

const MANUAL_MATRIX = [
  {
    case: "Senior → Senior",
    candidate: { currentTitle: "Senior Software Engineer" },
    jobTitle: "Senior Software Engineer",
  },
  {
    case: "Senior → Principal",
    candidate: { currentTitle: "Senior Software Engineer" },
    jobTitle: "Principal Engineer",
  },
  {
    case: "Senior → Director",
    candidate: { currentTitle: "Senior Software Engineer" },
    jobTitle: "Director Product",
  },
  {
    case: "Principal → Senior",
    candidate: { currentTitle: "Principal Engineer" },
    jobTitle: "Senior Engineer",
  },
  {
    case: "Director → Senior",
    candidate: { currentTitle: "Director Engineering" },
    jobTitle: "Senior Engineer",
  },
  {
    case: "Junior → Staff",
    candidate: { currentTitle: "Junior Developer" },
    jobTitle: "Staff Engineer",
  },
  {
    case: "Junior → VP",
    candidate: { currentTitle: "Junior Developer" },
    jobTitle: "VP Engineering",
  },
  {
    case: "Unknown title",
    candidate: {},
    jobTitle: "Team Member",
  },
];

function jobFromTitle(title) {
  return {
    id: "manual",
    title,
    experienceLevel: null,
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

function scorePipeline(skillsFitScore, experienceFit, seniorityFit) {
  const raw = blendResumeFitScore(
    skillsFitScore,
    experienceFit.experienceFitScore,
    seniorityFit.seniorityFitScore,
  );
  const expCap = applyExperienceGapCap(
    raw,
    experienceFit.candidateYears,
    experienceFit.requiredYears,
  );
  const senCap = applySeniorityGapCap(
    expCap.score,
    seniorityFit.candidateLevel,
    seniorityFit.jobLevel,
  );
  return {
    rawScore: raw,
    experienceScore: experienceFit.experienceFitScore,
    seniorityScore: seniorityFit.seniorityFitScore,
    experienceCap: expCap.cap,
    seniorityCap: senCap.cap,
    finalScore: senCap.score,
  };
}

async function main() {
  clearScoreCache();
  const rand = mulberry32(404);

  const jobs = shuffle(
    await prisma.job.findMany({
      where: { isActive: true, isPublishable: true },
      select: {
        id: true,
        title: true,
        role: true,
        experienceLevel: true,
        skills: true,
        description: true,
        parsedDescription: true,
        companyId: true,
      },
      take: 500,
      orderBy: { listingFreshnessAt: "desc" },
    }),
    rand,
  ).slice(0, JOB_SAMPLE);

  const users = shuffle(
    await prisma.user.findMany({
      where: { OR: [{ resumeText: { not: null } }, { resumeFileName: { not: null } }] },
      select: {
        yearsOfExperience: true,
        currentTitle: true,
        resumeStructuredV1: true,
        applyProfileSummary: true,
      },
      take: 500,
      orderBy: { resumeUpdatedAt: "desc" },
    }),
    rand,
  ).slice(0, RESUME_SAMPLE);

  let candidateCoverage = 0;
  let jobCoverage = 0;
  let seniorityFitPairs = 0;
  let gapSum = 0;
  let gapCount = 0;
  const falseDetections = [];
  const beforeAfter = [];

  for (const row of jobs) {
    const job = toDetailJobItem(row);
    const jobSen = deriveJobSeniority(job);
    if (jobSen.level != null) jobCoverage++;
  }

  for (const user of users) {
    const candidate = candidateExperienceFromApplyProfile(user);
    const candSen = deriveCandidateSeniority(candidate);
    if (candSen.level != null) candidateCoverage++;
  }

  const t0 = performance.now();
  const latencies = [];
  for (const row of jobs.slice(0, 50)) {
    const job = toDetailJobItem(row);
    const user = users[0] ?? {};
    const t1 = performance.now();
    scoreResume(SYNTHETIC_RESUME, [], job, {}, candidateExperienceFromApplyProfile(user));
    latencies.push(performance.now() - t1);
  }
  latencies.sort((a, b) => a - b);
  const p95Ms = latencies[Math.floor(latencies.length * 0.95)] ?? 0;

  for (let i = 0; i < Math.min(jobs.length, users.length); i++) {
    const job = toDetailJobItem(jobs[i]);
    const candidate = candidateExperienceFromApplyProfile(users[i]);
    const seniorityFit = computeSeniorityFit(job, candidate);
    if (
      seniorityFit.candidateLevel != null &&
      seniorityFit.jobLevel != null &&
      seniorityFit.seniorityFitScore != null
    ) {
      seniorityFitPairs++;
      gapSum += Math.abs(seniorityFit.candidateLevel - seniorityFit.jobLevel);
      gapCount++;
    }

    if (beforeAfter.length === 0) {
      const cand = { currentTitle: "Senior Software Engineer", yearsOfExperience: 6 };
      const seniorJob = jobFromTitle("Senior Software Engineer");
      const principalJob = jobFromTitle("Principal Engineer");
      const phase3Blend = (skills, exp, sen) =>
        Math.round(skills * 0.8 + (exp ?? skills) * 0.2);
      const senFit = computeSeniorityFit(seniorJob, cand);
      const priFit = computeSeniorityFit(principalJob, cand);
      const expFit = computeExperienceFit(seniorJob, cand);
      beforeAfter.push({
        scenario: "Senior candidate vs Senior role",
        phase3Final: phase3Blend(90, 100, null),
        skillsFitScore: 90,
        experienceFitScore: 100,
        seniorityFitScore: senFit.seniorityFitScore,
        blendedBeforeCap: blendResumeFitScore(90, 100, senFit.seniorityFitScore),
        finalScore: scoreResume(SYNTHETIC_RESUME, [], seniorJob, {}, cand).score,
      });
      beforeAfter.push({
        scenario: "Senior candidate vs Principal role (same years)",
        phase3Final: phase3Blend(90, 100, null),
        skillsFitScore: 90,
        experienceFitScore: 100,
        seniorityFitScore: priFit.seniorityFitScore,
        blendedBeforeCap: blendResumeFitScore(90, 100, priFit.seniorityFitScore),
        finalScore: scoreResume(SYNTHETIC_RESUME, [], principalJob, {}, cand).score,
      });
      beforeAfter.push({
        scenario: "Phase 3 vs 4 principal differentiation",
        phase3SeniorityEquivalent: true,
        phase4SeniorityScore: priFit.seniorityFitScore,
        experienceYears: expFit.candidateYears,
      });
    }
  }

  const manualResults = MANUAL_MATRIX.map((spec) => {
    const job = jobFromTitle(spec.jobTitle);
    const seniorityFit = computeSeniorityFit(job, spec.candidate);
    const experienceFit = computeExperienceFit(job, spec.candidate);
    const pipeline = scorePipeline(90, experienceFit, seniorityFit);
    const pass =
      spec.case === "Unknown title"
        ? seniorityFit.seniorityFitScore == null
        : seniorityFit.seniorityFitScore != null;
    if (!pass) {
      falseDetections.push({ case: spec.case, reason: "expected seniority score" });
    }
    return {
      case: spec.case,
      candidateLevel: seniorityFit.candidateLevel,
      jobLevel: seniorityFit.jobLevel,
      ...pipeline,
    };
  });

  const candPct = users.length ? ((candidateCoverage / users.length) * 100).toFixed(1) : "0";
  const jobPct = jobs.length ? ((jobCoverage / jobs.length) * 100).toFixed(1) : "0";
  const fitPct =
    users.length && jobs.length
      ? (((seniorityFitPairs / Math.min(jobs.length, users.length)) * 100).toFixed(1))
      : "0";

  let phase23 = null;
  let phase31 = null;
  try {
    phase23 = JSON.parse(
      readFileSync(join(root, "scripts/audit/phase23-credibility-audit.json"), "utf8"),
    );
  } catch {
    /* optional */
  }
  try {
    phase31 = JSON.parse(
      readFileSync(join(root, "scripts/audit/phase31-experience-calibration-report.json"), "utf8"),
    );
  } catch {
    /* optional */
  }

  const juniorStaffViolations = manualResults.filter(
    (m) =>
      (m.case === "Junior → Staff" || m.case === "Junior → VP") &&
      m.finalScore != null &&
      m.finalScore > 65,
  );

  const report = {
    measuredAt: new Date().toISOString(),
    metrics: {
      candidateCoverage: `${candidateCoverage}/${users.length} (${candPct}%)`,
      jobCoverage: `${jobCoverage}/${jobs.length} (${jobPct}%)`,
      seniorityFitCoverage: `${seniorityFitPairs}/${Math.min(jobs.length, users.length)} (${fitPct}%)`,
      averageGap: gapCount > 0 ? (gapSum / gapCount).toFixed(2) : "0",
      falseDetections,
      p95ScoreMs: Math.round(p95Ms * 100) / 100,
    },
    manualTestMatrix: manualResults,
    beforeAfterSamples: beforeAfter,
    regression: {
      phase23: phase23?.validation ?? null,
      phase31: phase31?.successCriteria ?? null,
    },
    successCriteria: {
      candidateCoverage70Pct: Number(candPct) >= 70,
      jobCoverage70Pct: Number(jobPct) >= 70,
      principalVsSeniorDifferentiated: beforeAfter.some(
        (b) => b.scenario?.includes("Principal") && b.seniorityFitScore != null && b.seniorityFitScore < 100,
      ) || manualResults.some((m) => m.case === "Senior → Principal" && m.seniorityScore === 40),
      phase23UnavailableUnder3Pct: phase23?.validation?.unavailableTargetMet ?? null,
      juniorStaffMax65: juniorStaffViolations.length === 0,
      p95Under150ms: p95Ms < 150,
    },
    recommendation:
      Number(candPct) >= 70 &&
      Number(jobPct) >= 70 &&
      juniorStaffViolations.length === 0 &&
      p95Ms < 150 &&
      (phase23?.validation?.unavailableTargetMet ?? true)
        ? "GO"
        : "NO_GO",
  };

  const outPath = join(root, "scripts/audit/phase4-seniority-fit-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("\n=== Phase 4 Seniority Fit Audit ===\n");
  console.log(`Recommendation: ${report.recommendation}`);
  console.log(`Candidate coverage: ${report.metrics.candidateCoverage}`);
  console.log(`Job coverage: ${report.metrics.jobCoverage}`);
  console.log(`Seniority fit coverage: ${report.metrics.seniorityFitCoverage}`);
  console.log(`Average gap: ${report.metrics.averageGap}`);
  console.log(`P95 score ms: ${report.metrics.p95ScoreMs}`);
  console.log(`False detections: ${falseDetections.length}`);
  console.log(`\nSaved: ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
