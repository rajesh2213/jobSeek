/**
 * Phase 5.2 Part D — high-score sanity check across real resume evaluations.
 * Run: cd apps/client && npx tsx ../../scripts/audit/resumeFitHighScoreSanityAudit.mjs
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
const { scoreResume, clearScoreCache, candidateExperienceFromApplyProfile } = await import(
  join(root, "apps/client/lib/resumeScorer.ts"),
);

const prisma = new PrismaClient();
const JOBS_PER_RESUME = 100;
const HIGH_SCORE_THRESHOLD = 75;

function parseBullets(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((b) => typeof b === "string");
  return [];
}

function pairKey(candidateFamily, jobFamily) {
  return `${candidateFamily ?? "null"} → ${jobFamily ?? "null"}`;
}

const SUSPICIOUS_PAIR_PATTERNS = [
  { candidate: /engineering/, job: /healthcare/, label: "engineering_vs_healthcare" },
  { candidate: /engineering/, job: /legal/, label: "engineering_vs_legal" },
  { candidate: /engineering/, job: /recruiting|hr/, label: "engineering_vs_hr" },
  { candidate: /engineering\.fullstack/, job: /engineering\.fullstack/, title: /technician/i, label: "fullstack_technician" },
  { candidate: /engineering/, job: /operations/, label: "engineering_vs_operations" },
];

function isSuspiciousPair(row) {
  const flags = [];
  const cand = row.candidateFamily ?? "";
  const job = row.jobFamily ?? "";
  for (const p of SUSPICIOUS_PAIR_PATTERNS) {
    if (p.candidate && !p.candidate.test(cand)) continue;
    if (p.job && !p.job.test(job)) continue;
    if (p.title && !p.title.test(row.jobTitle)) continue;
    flags.push(p.label);
  }
  return flags;
}

async function main() {
  const users = await prisma.user.findMany({
    where: { OR: [{ resumeText: { not: null } }, { resumeFileName: { not: null } }] },
    select: {
      id: true,
      email: true,
      currentTitle: true,
      yearsOfExperience: true,
      resumeText: true,
      resumeBullets: true,
      resumeStructuredV1: true,
      applyProfileSummary: true,
      resumeFileName: true,
    },
    orderBy: { resumeUpdatedAt: "desc" },
  });

  const jobs = await prisma.job.findMany({
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
      experienceLevel: true,
    },
    take: JOBS_PER_RESUME,
    orderBy: { listingFreshnessAt: "desc" },
  });

  const jobItems = jobs.map((row) => toDetailJobItem(row));
  const pairCounts = new Map();
  const highScoreRows = [];
  const suspiciousPairings = [];

  for (const user of users) {
    clearScoreCache();
    const resumeText = user.resumeText?.trim() ?? "";
    const bullets = parseBullets(user.resumeBullets);
    const profile = candidateExperienceFromApplyProfile(user);

    for (const job of jobItems) {
      const scored = scoreResume(resumeText, bullets, job, {}, profile);
      if (scored.matchAvailability !== "scored" || scored.score == null) continue;
      if (scored.score < HIGH_SCORE_THRESHOLD) continue;

      const row = {
        resumeId: user.id,
        resumeLabel: user.resumeFileName ?? user.email,
        jobId: job.id,
        jobTitle: job.title,
        jobCategory: job.category,
        finalScore: scored.score,
        skillsFitScore: scored.skillsFitScore,
        experienceFitScore: scored.experienceFitScore,
        seniorityFitScore: scored.seniorityFitScore,
        titleFitScore: scored.titleFitScore,
        confidence: scored.confidenceLevel,
        candidateFamily: scored.candidateRoleFamily,
        jobFamily: scored.jobRoleFamily,
        candidateTitle: scored.candidateTitleAlignment,
      };

      highScoreRows.push(row);
      const key = pairKey(row.candidateFamily, row.jobFamily);
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);

      const flags = isSuspiciousPair(row);
      if (flags.length) {
        suspiciousPairings.push({ ...row, flags });
      }
    }
  }

  const pairGroups = [...pairCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([pair, count]) => {
      const [candidate, job] = pair.split(" → ");
      return { candidate, job, count };
    });

  const report = {
    measuredAt: new Date().toISOString(),
    threshold: HIGH_SCORE_THRESHOLD,
    resumesEvaluated: users.length,
    jobsPerResume: JOBS_PER_RESUME,
    highScoreCount: highScoreRows.length,
    pairGroups,
    suspiciousPairings: suspiciousPairings.sort((a, b) => b.finalScore - a.finalScore),
    topHighScores: highScoreRows.sort((a, b) => b.finalScore - a.finalScore).slice(0, 25),
  };

  const outPath = join(root, "scripts/audit/resume-fit-high-score-sanity-audit.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("\n=== Phase 5.2 Part D — High Score Sanity Audit ===\n");
  console.log(`High scores (≥${HIGH_SCORE_THRESHOLD}): ${highScoreRows.length}`);
  console.log(`Suspicious pairings: ${suspiciousPairings.length}`);
  console.log("\nTop pair groups:");
  for (const g of pairGroups.slice(0, 12)) {
    console.log(`  ${g.candidate} → ${g.job}: ${g.count}`);
  }
  console.log(`\nSaved: ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
