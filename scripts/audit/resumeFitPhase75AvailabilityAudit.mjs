/**
 * Phase 7.5 availability optimization audit (read-only).
 * Run: cd apps/client && npx tsx ../../scripts/audit/resumeFitPhase75AvailabilityAudit.mjs
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toDetailJobItem } from "./lib/jobItemForAudit.mjs";

const auditDir = dirname(fileURLToPath(import.meta.url));
const root = join(auditDir, "../..");
const require = createRequire(join(root, "apps/server/package.json"));
const { register } = await import("tsx/esm/api");
register();

const { PrismaClient } = require("@prisma/client");
const { resolveJobMatchSkillsWithMeta } = await import(join(root, "apps/client/lib/jobMatchSignals.ts"));
const { applyCredibilityCalibration, shouldGateInsufficientEvidence } = await import(
  join(root, "apps/client/lib/resumeFitCalibration.ts"),
);
const { applyFitReliability } = await import(join(root, "apps/client/lib/resumeFitReliability.ts"));
const {
  computeTitleFit,
  deriveCandidateRoleFamily,
  deriveJobRoleFamily,
  isTitleFamilyMismatch,
  titleFitRelation,
} = await import(join(root, "apps/client/lib/resumeFitTitle.ts"));
const { scoreResume, clearScoreCache, candidateExperienceFromApplyProfile } = await import(
  join(root, "apps/client/lib/resumeScorer.ts"),
);

const prisma = new PrismaClient();
const JOBS_COUNT = 500;
const FEED_JOBS_PER_RESUME = 100;

const REASONS = [
  "title_mismatch",
  "insufficient_job_signals",
  "insufficient_candidate_signals",
  "low_signal_count",
  "title_unknown",
  "family_unresolvable",
  "reliability_gate",
  "other",
];

function parseBullets(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((b) => typeof b === "string");
  return [];
}

function candidateTitleInput(user, resumeText) {
  return {
    currentTitle: user.currentTitle,
    resumeStructuredV1: user.resumeStructuredV1,
    applyProfileSummary: user.applyProfileSummary,
    resumeText,
  };
}

function resumeHasCandidateSignals(user, resumeText) {
  const derived = deriveCandidateRoleFamily(candidateTitleInput(user, resumeText));
  return Boolean(
    derived.family ||
      derived.source ||
      user.currentTitle?.trim() ||
      resumeText?.trim()?.length > 100,
  );
}

function classifyUnavailable({
  scored,
  resolution,
  titleFit,
  calibration,
  reliability,
  user,
  resumeText,
}) {
  if (scored.matchAvailability === "scored") return null;

  if (scored.matchAvailability === "insufficient_job_signals") {
    return "insufficient_job_signals";
  }

  if (resolution.skills.length === 0 || resolution.unavailableReason) {
    return "insufficient_job_signals";
  }

  if (calibration.outcome === "insufficient_evidence") {
    return "low_signal_count";
  }

  if (reliability.gateUnavailable) {
    if (
      titleFit.jobFamily != null &&
      titleFit.candidateSource != null &&
      titleFit.candidateFamily == null
    ) {
      return "title_unknown";
    }
    if (
      titleFit.candidateFamily != null &&
      titleFit.jobFamily != null &&
      isTitleFamilyMismatch(titleFit.candidateFamily, titleFit.jobFamily) &&
      (titleFit.titleFitScore ?? 0) < 40
    ) {
      return "title_mismatch";
    }
    if (resolution.signalCount < 2) return "low_signal_count";
    if (resolution.fitTier != null && resolution.fitTier >= 3 && resolution.signalCount < 3) {
      return "low_signal_count";
    }
    return "reliability_gate";
  }

  if (!resumeHasCandidateSignals(user, resumeText)) {
    return "insufficient_candidate_signals";
  }

  if (titleFit.candidateFamily == null && titleFit.jobFamily == null) {
    return "family_unresolvable";
  }

  return "other";
}

function feedAlignmentBucket(candidateFamily, jobFamily) {
  if (!candidateFamily || !jobFamily) return "cross_domain";
  const rel = titleFitRelation(candidateFamily, jobFamily);
  if (rel === "same") return "same_family";
  if (rel === "adjacent" || rel === "related") return "adjacent_family";
  return "cross_domain";
}

function isFalseHigh(score, titleFitScore, candidateFamily, jobFamily) {
  if (score == null || score < 80) return false;
  if (titleFitScore != null && titleFitScore <= 40) return true;
  if (
    candidateFamily &&
    jobFamily &&
    isTitleFamilyMismatch(candidateFamily, jobFamily) &&
    (titleFitScore ?? 0) < 60
  ) {
    return true;
  }
  return false;
}

function isHumanQualityRisk(score, titleFitScore, candidateFamily, jobFamily, confidence) {
  if (score == null || score < 75) return false;
  if (titleFitScore != null && titleFitScore < 50) return true;
  if (candidateFamily && jobFamily && isTitleFamilyMismatch(candidateFamily, jobFamily)) return true;
  if (confidence === "very_low" && score >= 80) return true;
  return false;
}

async function evaluateRow(user, job, resumeText, bullets, profile) {
  const scored = scoreResume(resumeText, bullets, job, {}, profile);
  const resolution = resolveJobMatchSkillsWithMeta(job);
  const titleFit = computeTitleFit(job, candidateTitleInput(user, resumeText));
  const calibration = applyCredibilityCalibration({
    rawScore: 50,
    signalCount: resolution.signalCount,
    fitTier: resolution.fitTier,
  });
  const reliability = applyFitReliability({
    baseConfidence: resolution.confidence,
    fitTier: resolution.fitTier,
    signalCount: resolution.signalCount,
    titleFit,
  });

  const reason = classifyUnavailable({
    scored,
    resolution,
    titleFit,
    calibration,
    reliability,
    user,
    resumeText,
  });

  const calibrationPassed = calibration.outcome === "scored";
  const reliabilityGated = calibrationPassed && reliability.gateUnavailable;
  const titleMismatchOnly = reliabilityGated && reason === "title_mismatch";

  let preGateScore = scored.score;
  if (preGateScore == null && calibrationPassed && scored.blendedScoreBeforeCap != null) {
    preGateScore = scored.blendedScoreBeforeCap;
    if (scored.experienceGapCapApplied && scored.experienceGapCap != null) {
      preGateScore = Math.min(preGateScore, scored.experienceGapCap);
    }
    if (scored.seniorityGapCapApplied && scored.seniorityGapCap != null) {
      preGateScore = Math.min(preGateScore, scored.seniorityGapCap);
    }
    if (scored.titleMismatchCapApplied && scored.titleMismatchCap != null) {
      preGateScore = Math.min(preGateScore, scored.titleMismatchCap);
    }
    preGateScore = Math.round(preGateScore);
  }

  return {
    scored,
    reason,
    titleFit,
    resolution,
    reliability,
    calibration,
    reliabilityGated,
    titleMismatchOnly,
    preGateScore,
    candidateFamily: titleFit.candidateFamily,
    jobFamily: titleFit.jobFamily,
  };
}

async function main() {
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
    take: JOBS_COUNT,
    orderBy: { listingFreshnessAt: "desc" },
  });

  const users = await prisma.user.findMany({
    where: { OR: [{ resumeText: { not: null } }, { resumeFileName: { not: null } }] },
    select: {
      id: true,
      email: true,
      resumeFileName: true,
      currentTitle: true,
      yearsOfExperience: true,
      resumeText: true,
      resumeBullets: true,
      resumeStructuredV1: true,
      applyProfileSummary: true,
    },
    orderBy: { resumeUpdatedAt: "desc" },
  });

  const jobItems = jobs.map((r) => toDetailJobItem(r));
  const feedJobs = jobItems.slice(0, FEED_JOBS_PER_RESUME);

  const breakdown = Object.fromEntries(REASONS.map((r) => [r, 0]));
  const breakdownByResume = {};
  const mismatchMatrix = {};
  let total = 0;
  let unavailable = 0;
  let scored = 0;

  const recovery = {
    A_current: { available: 0, falseHigh: 0, hqRisk: 0 },
    B_titleMismatchWarning: { available: 0, falseHigh: 0, hqRisk: 0 },
    C_veryLowConfidence: { available: 0, falseHigh: 0, hqRisk: 0 },
    D_skillsGte70: { available: 0, falseHigh: 0, hqRisk: 0 },
  };

  const feedAlignment = {};

  for (const user of users) {
    clearScoreCache();
    const resumeText = user.resumeText?.trim() ?? "";
    const bullets = parseBullets(user.resumeBullets);
    const profile = candidateExperienceFromApplyProfile(user);
    const label = user.resumeFileName ?? user.email ?? user.id.slice(0, 8);
    breakdownByResume[label] = Object.fromEntries(REASONS.map((r) => [r, 0]));

    const candDerived = deriveCandidateRoleFamily(candidateTitleInput(user, resumeText));
    const feedBuckets = { same_family: 0, adjacent_family: 0, cross_domain: 0, unclassified: 0 };

    for (const job of feedJobs) {
      const jobFam = deriveJobRoleFamily(job);
      const align = feedAlignmentBucket(candDerived.family, jobFam.family);
      if (!candDerived.family || !jobFam.family) feedBuckets.unclassified++;
      else feedBuckets[align]++;
    }

    feedAlignment[label] = {
      resumeId: user.id,
      candidateFamily: candDerived.family,
      candidateTitle: candDerived.title,
      jobsInFeed: feedJobs.length,
      ...feedBuckets,
      sameFamilyPct: `${((feedBuckets.same_family / feedJobs.length) * 100).toFixed(1)}%`,
      crossDomainPct: `${((feedBuckets.cross_domain / feedJobs.length) * 100).toFixed(1)}%`,
    };

    for (const job of jobItems) {
      total++;
      const ev = await evaluateRow(user, job, resumeText, bullets, profile);

      if (ev.scored.matchAvailability === "scored") {
        scored++;
      } else {
        unavailable++;
        const r = ev.reason ?? "other";
        breakdown[r] = (breakdown[r] ?? 0) + 1;
        breakdownByResume[label][r] = (breakdownByResume[label][r] ?? 0) + 1;

        const pair = `${ev.candidateFamily ?? "null"}→${ev.jobFamily ?? "null"}`;
        mismatchMatrix[pair] = (mismatchMatrix[pair] ?? 0) + 1;
      }

      const conf = ev.scored.confidenceLevel;
      const ts = ev.scored.titleFitScore;
      const cf = ev.candidateFamily;
      const jf = ev.jobFamily;
      const pre = ev.preGateScore;

      // A: current
      if (ev.scored.matchAvailability === "scored" && ev.scored.score != null) {
        recovery.A_current.available++;
        if (isFalseHigh(ev.scored.score, ts, cf, jf)) recovery.A_current.falseHigh++;
        if (isHumanQualityRisk(ev.scored.score, ts, cf, jf, conf)) recovery.A_current.hqRisk++;
      }

      // B: show score + warning for title mismatch only
      const availB =
        ev.scored.matchAvailability === "scored" ||
        (ev.titleMismatchOnly && pre != null);
      if (availB && pre != null) {
        recovery.B_titleMismatchWarning.available++;
        if (isFalseHigh(pre, ts, cf, jf)) recovery.B_titleMismatchWarning.falseHigh++;
        if (isHumanQualityRisk(pre, ts, cf, jf, "very_low")) recovery.B_titleMismatchWarning.hqRisk++;
      }

      // C: show score + very_low for any reliability-gated with pre-score
      const availC =
        ev.scored.matchAvailability === "scored" ||
        (ev.reliabilityGated && pre != null);
      if (availC && (ev.scored.score ?? pre) != null) {
        const sc = ev.scored.score ?? pre;
        recovery.C_veryLowConfidence.available++;
        if (isFalseHigh(sc, ts, cf, jf)) recovery.C_veryLowConfidence.falseHigh++;
        if (isHumanQualityRisk(sc, ts, cf, jf, "very_low")) recovery.C_veryLowConfidence.hqRisk++;
      }

      // D: show score when skills >= 70
      const skills = ev.scored.skillsFitScore;
      const availD =
        ev.scored.matchAvailability === "scored" ||
        (skills != null && skills >= 70 && pre != null);
      if (availD) {
        const sc = ev.scored.score ?? pre;
        if (sc != null) {
          recovery.D_skillsGte70.available++;
          if (isFalseHigh(sc, ts, cf, jf)) recovery.D_skillsGte70.falseHigh++;
          if (isHumanQualityRisk(sc, ts, cf, jf, conf)) recovery.D_skillsGte70.hqRisk++;
        }
      }
    }
  }

  const dominant = Object.entries(breakdown).sort((a, b) => b[1] - a[1])[0];
  const dominantPct = unavailable ? ((dominant[1] / unavailable) * 100).toFixed(1) : "0";

  const mismatchSorted = Object.entries(mismatchMatrix)
    .sort((a, b) => b[1] - a[1])
    .map(([pair, count]) => ({ pair, count, pctOfUnavailable: `${((count / unavailable) * 100).toFixed(1)}%` }));

  const recoveryReport = {
    measuredAt: new Date().toISOString(),
    totalEvaluations: total,
    scenarios: Object.fromEntries(
      Object.entries(recovery).map(([key, val]) => [
        key,
        {
          ...val,
          availabilityPct: `${((val.available / total) * 100).toFixed(1)}%`,
          falseHighPct: val.available ? `${((val.falseHigh / val.available) * 100).toFixed(2)}%` : "0%",
          humanQualityRiskPct: val.available ? `${((val.hqRisk / val.available) * 100).toFixed(2)}%` : "0%",
        },
      ]),
    ),
    recommendation: null,
  };

  const bAvail = recovery.B_titleMismatchWarning.available / total;
  const cAvail = recovery.C_veryLowConfidence.available / total;
  const bRisk = recovery.B_titleMismatchWarning.falseHigh / Math.max(1, recovery.B_titleMismatchWarning.available);
  const cRisk = recovery.C_veryLowConfidence.falseHigh / Math.max(1, recovery.C_veryLowConfidence.available);

  if (bAvail >= 0.4 && bRisk < 0.02) {
    recoveryReport.recommendation = "B_titleMismatchWarning — best balance";
  } else if (cAvail >= 0.5 && cRisk < 0.03) {
    recoveryReport.recommendation = "C_veryLowConfidence — higher availability with acceptable risk";
  } else {
    recoveryReport.recommendation = "Keep current gating; prioritize feed personalization";
  }

  const avgCrossDomain =
    Object.values(feedAlignment).reduce((s, f) => s + parseFloat(f.crossDomainPct), 0) /
    Math.max(1, Object.keys(feedAlignment).length);

  const part1 = {
    measuredAt: new Date().toISOString(),
    jobs: jobItems.length,
    resumes: users.length,
    totalEvaluations: total,
    scored,
    unavailable,
    availabilityPct: `${((scored / total) * 100).toFixed(1)}%`,
    unavailablePct: `${((unavailable / total) * 100).toFixed(1)}%`,
    breakdown,
    breakdownPct: Object.fromEntries(
      REASONS.map((r) => [r, unavailable ? `${((breakdown[r] / unavailable) * 100).toFixed(1)}%` : "0%"]),
    ),
    dominantReason: dominant[0],
    dominantCount: dominant[1],
    dominantPct: `${dominantPct}%`,
    breakdownByResume,
  };

  const part2 = {
    measuredAt: new Date().toISOString(),
    unavailableEvaluations: unavailable,
    topPairs: mismatchSorted.slice(0, 25),
    fullMatrix: mismatchMatrix,
    insights: {
      crossDomainDominates: dominant[0] === "title_mismatch",
      nullCandidatePairs: mismatchSorted.filter((p) => p.pair.startsWith("null→")).reduce((s, p) => s + p.count, 0),
      feedPersonalizationWouldHelp: dominant[0] === "title_mismatch" || avgCrossDomain > 40,
    },
  };

  const part4 = {
    measuredAt: new Date().toISOString(),
    jobsPerFeed: FEED_JOBS_PER_RESUME,
    perResume: feedAlignment,
    aggregate: {
      avgSameFamilyPct: `${(Object.values(feedAlignment).reduce((s, f) => s + parseFloat(f.sameFamilyPct), 0) / Math.max(1, Object.keys(feedAlignment).length)).toFixed(1)}%`,
      avgCrossDomainPct: `${avgCrossDomain.toFixed(1)}%`,
    },
    conclusion: null,
  };

  part4.conclusion =
    avgCrossDomain > 50
      ? "Users browse mostly cross-domain jobs — unavailable is largely feed misalignment, not model strictness alone"
      : parseFloat(part1.availabilityPct) < 30 && dominant[0] === "title_mismatch"
        ? "Hybrid: model gates cross-domain checks; feed personalization would recover availability"
        : "Model strictness is primary driver";

  writeFileSync(join(auditDir, "phase75-availability-breakdown.json"), JSON.stringify(part1, null, 2));
  writeFileSync(join(auditDir, "phase75-family-mismatch-matrix.json"), JSON.stringify(part2, null, 2));
  writeFileSync(join(auditDir, "phase75-recovery-simulation.json"), JSON.stringify(recoveryReport, null, 2));
  writeFileSync(join(auditDir, "phase75-feed-alignment.json"), JSON.stringify(part4, null, 2));

  console.log("\n=== Phase 7.5 Availability Audit ===\n");
  console.log(`Availability: ${part1.availabilityPct} (${scored}/${total})`);
  console.log(`Dominant unavailable reason: ${dominant[0]} — ${dominantPct}%`);
  console.log("Breakdown:", part1.breakdownPct);
  console.log(`Feed avg cross-domain: ${part4.aggregate.avgCrossDomainPct}`);
  console.log(`Recovery B availability: ${recoveryReport.scenarios.B_titleMismatchWarning.availabilityPct}`);
  console.log(`Recovery C availability: ${recoveryReport.scenarios.C_veryLowConfidence.availabilityPct}`);
  console.log(`Recovery recommendation: ${recoveryReport.recommendation}`);
  console.log(`Feed conclusion: ${part4.conclusion}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
