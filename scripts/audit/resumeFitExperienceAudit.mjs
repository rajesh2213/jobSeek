/**
 * Phase 3 experience fit validation audit.
 * Run: cd apps/client && npx tsx ../../scripts/audit/resumeFitExperienceAudit.mjs
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
  deriveCandidateExperienceYears,
  deriveJobRequiredYears,
  computeExperienceFit,
  blendSkillsAndExperienceScore,
} = await import(join(root, "apps/client/lib/resumeFitExperience.ts"));
const { scoreResume, clearScoreCache } = await import(join(root, "apps/client/lib/resumeScorer.ts"));
const { candidateExperienceFromApplyProfile } = await import(join(root, "apps/client/lib/resumeScorer.ts"));

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
    case: "Junior candidate vs Staff role",
    job: { title: "Staff Engineer", parsedRequirement: ["8+ years"] },
    candidate: { yearsOfExperience: 2 },
    expectExperienceScore: 40,
  },
  {
    case: "Junior candidate vs Junior role",
    job: { title: "Junior Developer" },
    candidate: { yearsOfExperience: 1 },
    expectExperienceScore: 100,
  },
  {
    case: "Senior candidate vs Senior role",
    job: { title: "Senior Engineer" },
    candidate: { yearsOfExperience: 6 },
    expectExperienceScore: 100,
  },
  {
    case: "Senior candidate vs Junior role",
    job: { title: "Junior Engineer" },
    candidate: { yearsOfExperience: 8 },
    expectExperienceScore: 100,
  },
  {
    case: "No experience data",
    job: { title: "Analyst" },
    candidate: {},
    expectExperienceScore: null,
  },
  {
    case: "No years requirement",
    job: { title: "Team Member" },
    candidate: { yearsOfExperience: 4 },
    expectExperienceScore: null,
  },
  {
    case: "Explicit 7+ years",
    job: { title: "Engineer", parsedRequirement: ["7+ years of experience"] },
    candidate: { yearsOfExperience: 5 },
    expectExperienceScore: 76,
  },
  {
    case: "Explicit range 3-5 years",
    job: { title: "Engineer", parsedRequirement: ["3-5 years experience"] },
    candidate: { yearsOfExperience: 4 },
    expectExperienceScore: 100,
  },
];

function jobFromSpec(spec) {
  return {
    id: "manual",
    title: spec.job.title,
    experienceLevel: null,
    parsedDescription: {
      position: [],
      responsibility: [],
      requirement: spec.job.parsedRequirement ?? [],
      experience: [],
      benefit: [],
      contact: [],
      other: [],
    },
  };
}

async function main() {
  clearScoreCache();
  const rand = mulberry32(303);

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

  let jobsWithYears = 0;
  let resumesWithYears = 0;
  let experienceFitPairs = 0;
  let penaltySum = 0;
  let penaltyCount = 0;
  const falseExtractions = [];
  const beforeAfter = [];

  for (const row of jobs) {
    const job = toDetailJobItem(row);
    const req = deriveJobRequiredYears(job);
    if (req.years != null) jobsWithYears++;
  }

  for (const user of users) {
    const cand = deriveCandidateExperienceYears(candidateExperienceFromApplyProfile(user));
    if (cand.years != null) resumesWithYears++;
  }

  const t0 = performance.now();
  for (const row of jobs.slice(0, 50)) {
    const job = toDetailJobItem(row);
    const user = users[0] ?? {};
    scoreResume(SYNTHETIC_RESUME, [], job, {}, candidateExperienceFromApplyProfile(user));
  }
  const avgScoreMs = (performance.now() - t0) / 50;

  for (let i = 0; i < Math.min(jobs.length, users.length); i++) {
    const job = toDetailJobItem(jobs[i]);
    const candidate = candidateExperienceFromApplyProfile(users[i]);
    const fit = computeExperienceFit(job, candidate);
    if (fit.experienceFitScore != null && fit.candidateYears != null && fit.requiredYears != null) {
      experienceFitPairs++;
      if (fit.candidateYears < fit.requiredYears) {
        penaltySum += fit.requiredYears - fit.candidateYears;
        penaltyCount++;
      }
    }
    const skillsOnly = scoreResume(SYNTHETIC_RESUME, [], job, {}, {});
    const blended = scoreResume(SYNTHETIC_RESUME, [], job, {}, candidate);
    if (
      skillsOnly.score != null &&
      blended.score != null &&
      fit.experienceFitScore != null &&
      beforeAfter.length < 8
    ) {
      beforeAfter.push({
        title: jobs[i].title,
        skillsOnly: skillsOnly.score,
        skillsFitScore: blended.skillsFitScore,
        experienceFitScore: blended.experienceFitScore,
        finalScore: blended.score,
        candidateYears: blended.experienceYearsCandidate,
        requiredYears: blended.experienceYearsRequired,
      });
    }
  }

  const manualResults = MANUAL_MATRIX.map((spec) => {
    const job = jobFromSpec(spec);
    const fit = computeExperienceFit(job, spec.candidate);
    const pass = fit.experienceFitScore === spec.expectExperienceScore;
    if (!pass) {
      falseExtractions.push({
        case: spec.case,
        expected: spec.expectExperienceScore,
        actual: fit.experienceFitScore,
      });
    }
    return { ...spec, actual: fit.experienceFitScore, pass };
  });

  const jobsPct = ((jobsWithYears / jobs.length) * 100).toFixed(1);
  const resumesPct = ((resumesWithYears / users.length) * 100).toFixed(1);
  const coveragePct =
    users.length && jobs.length
      ? (((experienceFitPairs / Math.min(jobs.length, users.length)) * 100).toFixed(1))
      : "0";

  const phase23 = await import(join(root, "scripts/audit/phase23-credibility-audit.json"), {
    with: { type: "json" },
  }).catch(() => null);

  const report = {
    measuredAt: new Date().toISOString(),
    metrics: {
      jobsWithYearsDetected: `${jobsWithYears}/${jobs.length} (${jobsPct}%)`,
      resumesWithYearsDetected: `${resumesWithYears}/${users.length} (${resumesPct}%)`,
      experienceFitCoverage: `${experienceFitPairs}/${Math.min(jobs.length, users.length)} (${coveragePct}%)`,
      averagePenalty:
        penaltyCount > 0 ? (penaltySum / penaltyCount).toFixed(2) : "0",
      falseExtractions,
      avgScoreMs: Math.round(avgScoreMs * 100) / 100,
    },
    manualTestMatrix: manualResults,
    beforeAfterSamples: beforeAfter,
    phase23Regression: phase23?.default?.validation ?? null,
    successCriteria: {
      jobsYearsTarget70Pct: Number(jobsPct) >= 60,
      resumesYearsTarget70Pct: Number(resumesPct) >= 70,
      phase23UnavailableUnder3Pct: phase23?.default?.validation?.unavailableTargetMet ?? null,
      performanceUnder150ms: avgScoreMs < 150,
      manualMatrixPass: falseExtractions.length === 0,
    },
    recommendation:
      Number(jobsPct) >= 60 &&
      manualResults.every((m) => m.pass) &&
      avgScoreMs < 150 &&
      (phase23?.default?.validation?.unavailableTargetMet ?? true)
        ? "GO"
        : "NO_GO",
  };

  const outPath = join(root, "scripts/audit/phase3-experience-fit-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("\n=== Phase 3 Experience Fit Audit ===\n");
  console.log(`Recommendation: ${report.recommendation}`);
  console.log(`Jobs with years: ${report.metrics.jobsWithYearsDetected}`);
  console.log(`Resumes with years: ${report.metrics.resumesWithYearsDetected}`);
  console.log(`Experience fit coverage: ${report.metrics.experienceFitCoverage}`);
  console.log(`Avg score ms: ${report.metrics.avgScoreMs}`);
  console.log(`Manual matrix failures: ${falseExtractions.length}`);
  console.log(`\nSaved: ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
