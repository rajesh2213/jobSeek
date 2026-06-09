/**
 * Phase 3.1 experience gap calibration audit.
 * Run: cd apps/client && npx tsx ../../scripts/audit/resumeFitExperienceCalibrationAudit.mjs
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
  applyExperienceGapCap,
  blendSkillsAndExperienceScore,
  computeExperienceFitScore,
  deriveExperienceGapCap,
} = await import(join(root, "apps/client/lib/resumeFitExperience.ts"));
const { scoreResume, clearScoreCache, candidateExperienceFromApplyProfile } = await import(
  join(root, "apps/client/lib/resumeScorer.ts"),
);

const prisma = new PrismaClient();
const SYNTHETIC_RESUME =
  "Python SQL TypeScript React Kubernetes agile scrum 6 years experience senior engineer";

const MANUAL_MATRIX = [
  {
    case: "1 year vs 8 year role",
    candidateYears: 1,
    requiredYears: 8,
    skillsFitScore: 95,
  },
  {
    case: "2 year vs 5 year role",
    candidateYears: 2,
    requiredYears: 5,
    skillsFitScore: 90,
  },
  {
    case: "4 year vs 5 year role",
    candidateYears: 4,
    requiredYears: 5,
    skillsFitScore: 90,
  },
  {
    case: "8 year vs 5 year role",
    candidateYears: 8,
    requiredYears: 5,
    skillsFitScore: 90,
  },
  {
    case: "unknown experience",
    candidateYears: null,
    requiredYears: 8,
    skillsFitScore: 90,
  },
];

function jobFromTitle(title, requirement = []) {
  return {
    id: "manual",
    title,
    experienceLevel: null,
    parsedDescription: {
      position: [],
      responsibility: [],
      requirement,
      experience: [],
      benefit: [],
      contact: [],
      other: [],
    },
  };
}

function scoreWithExperience(job, candidateYears, skillsFitScore) {
  const experienceInput =
    candidateYears == null ? {} : { yearsOfExperience: candidateYears };
  const scored = scoreResume(SYNTHETIC_RESUME, [], job, {}, experienceInput);
  return {
    ...scored,
    skillsFitScore: skillsFitScore ?? scored.skillsFitScore,
    blendedScoreBeforeCap: blendSkillsAndExperienceScore(
      skillsFitScore ?? scored.skillsFitScore,
      computeExperienceFitScore(candidateYears, scored.experienceYearsRequired),
    ),
  };
}

async function main() {
  clearScoreCache();

  const jobs = await prisma.job.findMany({
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
    take: 200,
    orderBy: { listingFreshnessAt: "desc" },
  });

  const users = await prisma.user.findMany({
    where: { OR: [{ resumeText: { not: null } }, { resumeFileName: { not: null } }] },
    select: {
      yearsOfExperience: true,
      currentTitle: true,
      resumeStructuredV1: true,
      applyProfileSummary: true,
    },
    take: 50,
    orderBy: { resumeUpdatedAt: "desc" },
  });

  let cappedCount = 0;
  let capReductionSum = 0;
  const falsePositives = [];
  const juniorToStaff = [];
  const staffToJunior = [];

  for (let i = 0; i < Math.min(jobs.length, users.length); i++) {
    const job = toDetailJobItem(jobs[i]);
    const candidate = candidateExperienceFromApplyProfile(users[i]);
    const scored = scoreResume(SYNTHETIC_RESUME, [], job, {}, candidate);
    if (!scored.score && scored.score !== 0) continue;

    if (scored.experienceGapCapApplied) {
      cappedCount++;
      const before = scored.blendedScoreBeforeCap ?? scored.score;
      capReductionSum += before - scored.score;
      if (
        scored.experienceYearsCandidate != null &&
        scored.experienceYearsRequired != null &&
        scored.experienceYearsCandidate >= scored.experienceYearsRequired
      ) {
        falsePositives.push({
          title: jobs[i].title,
          candidateYears: scored.experienceYearsCandidate,
          requiredYears: scored.experienceYearsRequired,
          reason: "overqualified",
        });
      }
    }

    const title = (jobs[i].title ?? "").toLowerCase();
    const candYears = scored.experienceYearsCandidate;
    const reqYears = scored.experienceYearsRequired;
    if (
      candYears != null &&
      reqYears != null &&
      candYears <= 3 &&
      /\b(staff|principal|senior|lead|director)\b/i.test(title) &&
      juniorToStaff.length < 5
    ) {
      juniorToStaff.push({
        title: jobs[i].title,
        candidateYears: candYears,
        requiredYears: reqYears,
        skillsFitScore: scored.skillsFitScore,
        experienceFitScore: scored.experienceFitScore,
        blendedBeforeCap: scored.blendedScoreBeforeCap,
        cap: scored.experienceGapCap,
        finalScore: scored.score,
      });
    }
    if (
      candYears != null &&
      reqYears != null &&
      candYears >= 7 &&
      /\b(junior|intern|associate)\b/i.test(title) &&
      staffToJunior.length < 5
    ) {
      staffToJunior.push({
        title: jobs[i].title,
        candidateYears: candYears,
        requiredYears: reqYears,
        skillsFitScore: scored.skillsFitScore,
        experienceFitScore: scored.experienceFitScore,
        blendedBeforeCap: scored.blendedScoreBeforeCap,
        cap: scored.experienceGapCap,
        finalScore: scored.score,
      });
    }
  }

  const manualResults = MANUAL_MATRIX.map((spec) => {
    const experienceScore = computeExperienceFitScore(spec.candidateYears, spec.requiredYears);
    const rawScore = blendSkillsAndExperienceScore(spec.skillsFitScore, experienceScore);
    const cap = deriveExperienceGapCap(spec.candidateYears, spec.requiredYears);
    const applied = applyExperienceGapCap(rawScore, spec.candidateYears, spec.requiredYears);
    return {
      case: spec.case,
      rawScore,
      experienceScore,
      cap,
      finalScore: applied.score,
      capApplied: applied.capApplied,
    };
  });

  const syntheticStaff = scoreWithExperience(
    jobFromTitle("Staff Engineer", ["8+ years"]),
    2,
    95,
  );
  const syntheticStaffFinal = applyExperienceGapCap(
    blendSkillsAndExperienceScore(95, 40),
    2,
    8,
  );

  const juniorStaffViolations = [
    ...juniorToStaff.filter((e) => e.finalScore > 65),
    ...(syntheticStaffFinal.score > 65
      ? [{ title: "Staff Engineer (synthetic)", finalScore: syntheticStaffFinal.score }]
      : []),
  ];

  const largeGapViolations = manualResults
    .filter((m) => {
      const gap =
        m.cap != null && MANUAL_MATRIX.find((x) => x.case === m.case)?.requiredYears != null
          ? MANUAL_MATRIX.find((x) => x.case === m.case).requiredYears -
            (MANUAL_MATRIX.find((x) => x.case === m.case).candidateYears ?? 0)
          : 0;
      return gap >= 5 && m.finalScore > 50;
    })
    .map((m) => ({ case: m.case, finalScore: m.finalScore }));

  const phase23Path = join(root, "scripts/audit/phase23-credibility-audit.json");
  let phase23 = null;
  try {
    phase23 = JSON.parse(
      await import("node:fs").then((fs) =>
        fs.promises.readFile(phase23Path, "utf8"),
      ),
    );
  } catch {
    phase23 = null;
  }

  const paired = Math.min(jobs.length, users.length);
  const avgCapReduction = cappedCount > 0 ? (capReductionSum / cappedCount).toFixed(2) : "0";

  const report = {
    measuredAt: new Date().toISOString(),
    metrics: {
      jobsCapped: `${cappedCount}/${paired}`,
      averageCapReduction: avgCapReduction,
      falsePositives,
      juniorToStaffExamples: juniorToStaff,
      staffToJuniorExamples: staffToJunior,
    },
    manualTestMatrix: manualResults,
    syntheticExample: {
      candidateYears: 2,
      requiredYears: 8,
      skillsFitScore: 95,
      experienceFitScore: 40,
      blendedBeforeCap: 84,
      cap: 50,
      finalScore: syntheticStaffFinal.score,
    },
    successCriteria: {
      juniorStaffMax65: juniorStaffViolations.length === 0,
      largeGapMax50: largeGapViolations.length === 0,
      phase23UnavailableUnder3Pct: phase23?.validation?.unavailableTargetMet ?? null,
      falsePositiveCount: falsePositives.length,
    },
    phase23Regression: phase23?.validation ?? null,
    recommendation:
      juniorStaffViolations.length === 0 &&
      largeGapViolations.length === 0 &&
      falsePositives.length === 0 &&
      (phase23?.validation?.unavailableTargetMet ?? true)
        ? "GO"
        : "NO_GO",
  };

  const outPath = join(root, "scripts/audit/phase31-experience-calibration-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("\n=== Phase 3.1 Experience Calibration Audit ===\n");
  console.log(`Recommendation: ${report.recommendation}`);
  console.log(`Jobs capped: ${report.metrics.jobsCapped}`);
  console.log(`Average cap reduction: ${report.metrics.averageCapReduction}`);
  console.log(`False positives: ${falsePositives.length}`);
  console.log(`Junior→staff violations (>65): ${juniorStaffViolations.length}`);
  console.log(`Large-gap violations (>50): ${largeGapViolations.length}`);
  console.log(`\nSaved: ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
