/**
 * Phase 5.1 real resume matrix validation (read-only).
 * Run: cd apps/client && npx tsx ../../scripts/audit/resumeFitRealResumeMatrixAudit.mjs
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

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function avg(nums) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function parseBullets(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((b) => typeof b === "string");
  return [];
}

function matchRow(scored, job, userId) {
  return {
    resumeId: userId,
    jobId: job.id,
    jobTitle: job.title,
    jobCategory: job.category ?? null,
    finalScore: scored.score,
    skillsFitScore: scored.skillsFitScore ?? null,
    experienceFitScore: scored.experienceFitScore ?? null,
    seniorityFitScore: scored.seniorityFitScore ?? null,
    titleFitScore: scored.titleFitScore ?? null,
    confidence: scored.confidenceLevel ?? null,
    matchAvailability: scored.matchAvailability,
    candidateTitle: scored.candidateTitleAlignment ?? scored.candidateSeniorityTitle ?? null,
    candidateFamily: scored.candidateRoleFamily ?? null,
    jobFamily: scored.jobRoleFamily ?? null,
    signalCount: scored.signalCount ?? null,
    fitTier: scored.fitTier ?? null,
  };
}

function isSuspiciousHigh(row) {
  if (row.finalScore == null || row.finalScore < 80) return null;
  const flags = [];
  if (row.titleFitScore != null && row.titleFitScore <= 40) {
    flags.push("title_fit_low");
  }
  if (row.experienceFitScore != null && row.experienceFitScore <= 50) {
    flags.push("experience_fit_low");
  }
  if (row.seniorityFitScore != null && row.seniorityFitScore <= 40) {
    flags.push("seniority_fit_low");
  }
  return flags.length ? flags : null;
}

function isSuspiciousLow(row) {
  const { finalScore, skillsFitScore, experienceFitScore, seniorityFitScore, titleFitScore } = row;
  if (finalScore == null || finalScore >= 60) return false;
  if (skillsFitScore == null || experienceFitScore == null || seniorityFitScore == null || titleFitScore == null) {
    return false;
  }
  return (
    skillsFitScore >= 80 &&
    experienceFitScore >= 80 &&
    seniorityFitScore >= 80 &&
    titleFitScore >= 80
  );
}

function formatReviewBlock(resumeLabel, rows) {
  const lines = [`## ${resumeLabel}`, ""];
  for (const [i, r] of rows.entries()) {
    lines.push(`### ${i + 1}. ${r.jobTitle}`);
    lines.push("");
    lines.push(`| Field | Value |`);
    lines.push(`|-------|-------|`);
    lines.push(`| Final score | ${r.finalScore ?? "—"} |`);
    lines.push(`| Skills fit | ${r.skillsFitScore ?? "—"} |`);
    lines.push(`| Experience fit | ${r.experienceFitScore ?? "—"} |`);
    lines.push(`| Seniority fit | ${r.seniorityFitScore ?? "—"} |`);
    lines.push(`| Title alignment | ${r.titleFitScore ?? "—"} |`);
    lines.push(`| Confidence | ${r.confidence ?? "—"} |`);
    lines.push(`| Job ID | \`${r.jobId}\` |`);
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  clearScoreCache();

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
      resumeUpdatedAt: true,
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

  const perResume = [];
  const allScoredRows = [];
  const suspiciousHigh = [];
  const suspiciousLow = [];
  let totalEvaluations = 0;
  let scoredEvaluations = 0;
  let unavailableEvaluations = 0;
  const errors = [];

  for (const user of users) {
    clearScoreCache();
    const resumeText = user.resumeText?.trim() ?? "";
    const bullets = parseBullets(user.resumeBullets);
    const profile = candidateExperienceFromApplyProfile(user);
    const resumeLabel =
      user.currentTitle?.trim() ||
      user.resumeFileName ||
      user.email?.split("@")[0] ||
      user.id.slice(0, 8);

    const evaluations = [];

    for (const job of jobItems) {
      totalEvaluations++;
      try {
        const scored = scoreResume(resumeText, bullets, job, {}, profile);
        const row = matchRow(scored, job, user.id);
        evaluations.push(row);

        if (scored.matchAvailability === "scored" && scored.score != null) {
          scoredEvaluations++;
          allScoredRows.push(row);

          const highFlags = isSuspiciousHigh(row);
          if (highFlags) {
            suspiciousHigh.push({ ...row, flags: highFlags });
          }
          if (isSuspiciousLow(row)) {
            suspiciousLow.push(row);
          }
        } else {
          unavailableEvaluations++;
        }
      } catch (err) {
        errors.push({
          resumeId: user.id,
          jobId: job.id,
          error: String(err?.message ?? err),
        });
      }
    }

    const scoredOnly = evaluations
      .filter((e) => e.finalScore != null)
      .sort((a, b) => b.finalScore - a.finalScore);
    const scores = scoredOnly.map((e) => e.finalScore);

    perResume.push({
      resumeId: user.id,
      resumeLabel,
      email: user.email,
      currentTitle: user.currentTitle,
      yearsOfExperience: user.yearsOfExperience,
      hasResumeText: Boolean(resumeText),
      bulletCount: bullets.length,
      jobsEvaluated: evaluations.length,
      scoredCount: scoredOnly.length,
      unavailableCount: evaluations.length - scoredOnly.length,
      averageScore: scores.length ? Math.round(avg(scores) * 10) / 10 : null,
      medianScore: scores.length ? Math.round(median(scores) * 10) / 10 : null,
      topMatches: scoredOnly.slice(0, 10),
      bottomMatches: [...scoredOnly].reverse().slice(0, 10),
      topFiveForReview: scoredOnly.slice(0, 5),
    });
  }

  const highScoreEvals = allScoredRows.filter((r) => r.finalScore >= 80);
  const highScoreMismatchCount = suspiciousHigh.length;
  const highScoreMismatchPct =
    highScoreEvals.length > 0
      ? ((highScoreMismatchCount / highScoreEvals.length) * 100).toFixed(2)
      : "0.00";

  const severeTitleMismatchOver80 = suspiciousHigh.filter((s) =>
    s.flags.includes("title_fit_low"),
  );

  const topUnexpectedMatches = [...suspiciousHigh]
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, 15);

  const topUnexpectedMisses = allScoredRows
    .filter(
      (r) =>
        r.finalScore != null &&
        r.finalScore < 50 &&
        (r.skillsFitScore ?? 0) >= 70,
    )
    .sort((a, b) => (a.finalScore ?? 0) - (b.finalScore ?? 0))
    .slice(0, 15);

  const calibration = {
    highScoreMismatchCount: `${highScoreMismatchCount}/${highScoreEvals.length} (${highScoreMismatchPct}% of scores ≥80)`,
    lowScoreAnomalyCount: suspiciousLow.length,
    severeTitleMismatchOver80Count: severeTitleMismatchOver80.length,
    topUnexpectedMatches,
    topUnexpectedMisses,
    suspiciousHighExamples: suspiciousHigh.slice(0, 20),
    suspiciousLowExamples: suspiciousLow,
  };

  const successCriteria = {
    highScoreMismatchUnder2Pct: highScoreEvals.length === 0 || Number(highScoreMismatchPct) <= 2,
    lowScoreAnomaliesZero: suspiciousLow.length === 0,
    noSevereTitleMismatchOver80: severeTitleMismatchOver80.length === 0,
    noCrashes: errors.length === 0,
    targetEvaluationsMet: totalEvaluations >= 600 || (users.length > 0 && totalEvaluations >= users.length * 50),
  };

  const recommendation =
    successCriteria.highScoreMismatchUnder2Pct &&
    successCriteria.lowScoreAnomaliesZero &&
    successCriteria.noSevereTitleMismatchOver80 &&
    successCriteria.noCrashes
      ? "GO"
      : "NO_GO";

  const report = {
    measuredAt: new Date().toISOString(),
    dataset: {
      resumeCount: users.length,
      jobsPerResume: JOBS_PER_RESUME,
      totalEvaluations,
      scoredEvaluations,
      unavailableEvaluations,
      errors: errors.length,
    },
    perResume,
    calibration,
    successCriteria,
    recommendation,
    errors,
  };

  const jsonPath = join(root, "scripts/audit/resume-fit-real-resume-matrix.json");
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const mdLines = [
    "# Resume Fit — Real Resume Human Review Pack",
    "",
    `Generated: ${report.measuredAt}`,
    "",
    `**Resumes:** ${users.length} · **Jobs per resume:** ${JOBS_PER_RESUME} · **Total evaluations:** ${totalEvaluations}`,
    "",
    `**Recommendation:** ${recommendation}`,
    "",
    "## Calibration summary",
    "",
    `- High-score mismatches (≥80 with weak dimension): ${calibration.highScoreMismatchCount}`,
    `- Low-score anomalies (all dimensions ≥80, final <60): ${calibration.lowScoreAnomalyCount}`,
    `- Severe title mismatch with score ≥80: ${calibration.severeTitleMismatchOver80Count}`,
    "",
  ];

  if (suspiciousHigh.length) {
    mdLines.push("## Suspicious high scores", "");
    for (const s of suspiciousHigh.slice(0, 10)) {
      mdLines.push(
        `- **${s.finalScore}%** — ${s.jobTitle} (resume \`${s.resumeId.slice(0, 8)}…\`) — flags: ${s.flags.join(", ")}`,
      );
    }
    mdLines.push("");
  }

  if (suspiciousLow.length) {
    mdLines.push("## Suspicious low scores", "");
    for (const s of suspiciousLow) {
      mdLines.push(`- **${s.finalScore}%** — ${s.jobTitle}`);
    }
    mdLines.push("");
  }

  mdLines.push("---", "");

  for (const r of perResume) {
    mdLines.push(formatReviewBlock(`${r.resumeLabel} (\`${r.resumeId}\`)`, r.topFiveForReview));
    mdLines.push("---", "");
  }

  const mdPath = join(root, "scripts/audit/resume-fit-human-review.md");
  writeFileSync(mdPath, mdLines.join("\n"));

  console.log("\n=== Phase 5.1 Real Resume Matrix Audit ===\n");
  console.log(`Recommendation: ${recommendation}`);
  console.log(`Resumes: ${users.length}`);
  console.log(`Evaluations: ${totalEvaluations} (scored: ${scoredEvaluations}, unavailable: ${unavailableEvaluations})`);
  console.log(`High-score mismatches: ${calibration.highScoreMismatchCount}`);
  console.log(`Low-score anomalies: ${calibration.lowScoreAnomalyCount}`);
  console.log(`Severe title mismatch ≥80: ${calibration.severeTitleMismatchOver80Count}`);
  console.log(`Errors: ${errors.length}`);
  console.log(`\nSaved: ${jsonPath}`);
  console.log(`Saved: ${mdPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
