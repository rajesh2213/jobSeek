/**
 * Phase 5.2 Part A — Seán O'Shea resume failure root-cause audit.
 * Run: cd apps/client && npx tsx ../../scripts/audit/resumeFitSeanResumeFailureAudit.mjs
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

const SEAN_EMAIL = "osheaoconnors14@gmail.com";
const JOBS_SAMPLE = 100;

const { PrismaClient } = require("@prisma/client");
const { scoreResume, clearScoreCache, candidateExperienceFromApplyProfile } = await import(
  join(root, "apps/client/lib/resumeScorer.ts"),
);
const { resolveJobMatchSkillsWithMeta } = await import(join(root, "apps/client/lib/jobMatchSignals.ts"));
const { applyCredibilityCalibration, shouldGateInsufficientEvidence } = await import(
  join(root, "apps/client/lib/resumeFitCalibration.ts"),
);
const { applyFitReliability } = await import(join(root, "apps/client/lib/resumeFitReliability.ts"));
const {
  computeTitleFit,
  deriveCandidateRoleFamily,
  isTitleFamilyMismatch,
} = await import(join(root, "apps/client/lib/resumeFitTitle.ts"));
const { computeExperienceFit } = await import(join(root, "apps/client/lib/resumeFitExperience.ts"));
const { computeSeniorityFit } = await import(join(root, "apps/client/lib/resumeFitSeniority.ts"));

const prisma = new PrismaClient();

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

function classifyUnavailableGate({ resolution, titleFit, calibration, reliability }) {
  if (resolution.skills.length === 0 || resolution.unavailableReason) {
    return { bucket: "insufficient_job_signals", detail: resolution.unavailableReason ?? "no_skills" };
  }

  if (calibration.outcome === "insufficient_evidence") {
    if (shouldGateInsufficientEvidence(resolution.signalCount, resolution.fitTier)) {
      return {
        bucket: "signal_count",
        detail: `tier${resolution.fitTier}_signals${resolution.signalCount}`,
      };
    }
    return { bucket: "insufficient_evidence", detail: "calibration_cap_null" };
  }

  if (reliability.gateUnavailable) {
    const { signalCount, fitTier } = resolution;
    if (signalCount < 2) {
      return { bucket: "signal_count", detail: `signals${signalCount}` };
    }
    if (fitTier != null && fitTier >= 3 && signalCount < 3) {
      return { bucket: "signal_count", detail: `tier${fitTier}_signals${signalCount}` };
    }
    if (
      titleFit.jobFamily != null &&
      titleFit.candidateSource != null &&
      titleFit.candidateFamily == null
    ) {
      return {
        bucket: "title_unknown",
        detail: `candidate_title="${titleFit.candidateTitle ?? ""}" source=${titleFit.candidateSource}`,
      };
    }
    if (
      titleFit.candidateFamily != null &&
      titleFit.jobFamily != null &&
      isTitleFamilyMismatch(titleFit.candidateFamily, titleFit.jobFamily) &&
      (titleFit.titleFitScore ?? 0) < 40
    ) {
      return {
        bucket: "title_unknown",
        detail: `mismatch ${titleFit.candidateFamily}→${titleFit.jobFamily}`,
      };
    }
    return { bucket: "other", detail: "reliability_gate_unclassified" };
  }

  return null;
}

async function main() {
  clearScoreCache();

  const user = await prisma.user.findFirst({
    where: { email: SEAN_EMAIL },
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
  });

  if (!user) {
    console.error(`User not found: ${SEAN_EMAIL}`);
    process.exit(1);
  }

  const resumeText = user.resumeText?.trim() ?? "";
  const bullets = parseBullets(user.resumeBullets);
  const profile = candidateExperienceFromApplyProfile(user);
  const structured = user.resumeStructuredV1;
  const experienceEntries = structured?.experience ?? [];

  const titleDerived = deriveCandidateRoleFamily(candidateTitleInput(user, resumeText));
  const experienceFit = computeExperienceFit(
    { id: "probe", title: "Software Engineer", category: "engineering" },
    profile,
  );
  const seniorityFit = computeSeniorityFit(
    { id: "probe", title: "Software Engineer", category: "engineering" },
    profile,
  );

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
    take: JOBS_SAMPLE,
    orderBy: { listingFreshnessAt: "desc" },
  });

  const breakdown = {
    insufficient_evidence: 0,
    title_unknown: 0,
    signal_count: 0,
    insufficient_job_signals: 0,
    other: 0,
  };
  const detailCounts = {};
  const sampleJobs = [];

  for (const row of jobs) {
    const job = toDetailJobItem(row);
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

    let bucket;
    if (scored.matchAvailability === "scored") {
      bucket = "scored";
    } else if (scored.matchAvailability === "insufficient_job_signals") {
      bucket = "insufficient_job_signals";
    } else {
      const gate = classifyUnavailableGate({ resolution, titleFit, calibration, reliability });
      bucket = gate?.bucket ?? "other";
      const detailKey = gate?.detail ?? scored.matchAvailability;
      detailCounts[detailKey] = (detailCounts[detailKey] ?? 0) + 1;
      if (sampleJobs.length < 8) {
        sampleJobs.push({
          jobId: job.id,
          jobTitle: job.title,
          matchAvailability: scored.matchAvailability,
          bucket,
          detail: detailKey,
          signalCount: resolution.signalCount,
          fitTier: resolution.fitTier,
          candidateFamily: titleFit.candidateFamily,
          jobFamily: titleFit.jobFamily,
          candidateTitle: titleFit.candidateTitle,
          candidateSource: titleFit.candidateSource,
        });
      }
    }

    if (bucket !== "scored") {
      breakdown[bucket] = (breakdown[bucket] ?? 0) + 1;
    }
  }

  const resumeTextPreview = resumeText.slice(0, 500);
  const titleLinesFromText = resumeText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length >= 5 && l.length <= 90)
    .slice(0, 15);

  const report = {
    measuredAt: new Date().toISOString(),
    resume: {
      resumeId: user.id,
      fileName: user.resumeFileName,
      email: user.email,
      resumeTextLength: resumeText.length,
      resumeTextPreview,
      bulletsCount: bullets.length,
      bulletsPreview: bullets.slice(0, 5),
      structuredExperienceCount: experienceEntries.length,
      structuredExperienceRoles: experienceEntries.map((e) => ({
        role: e.role ?? null,
        company: e.company ?? null,
        startDate: e.startDate ?? null,
        endDate: e.endDate ?? null,
      })),
      currentTitle: user.currentTitle,
      yearsOfExperience: user.yearsOfExperience,
      applyProfileSummary: user.applyProfileSummary,
    },
    titleDetection: {
      candidateFamily: titleDerived.family,
      candidateTitle: titleDerived.title,
      candidateSource: titleDerived.source,
      titleLinesFromResumeText: titleLinesFromText,
    },
    experienceExtraction: {
      candidateYears: experienceFit.candidateYears,
      candidateSource: experienceFit.candidateSource,
    },
    seniorityExtraction: {
      candidateLevel: seniorityFit.candidateLevel,
      candidateTitle: seniorityFit.candidateTitle,
    },
    jobsSampled: jobs.length,
    scoredCount: jobs.length - Object.values(breakdown).reduce((a, b) => a + b, 0),
    unavailableReasonBreakdown: breakdown,
    detailCounts,
    sampleUnavailableJobs: sampleJobs,
    rootCause: null,
  };

  if (breakdown.title_unknown > 0 && titleDerived.family == null && titleDerived.source != null) {
    report.rootCause =
      "Reliability gate: candidate title detected but no role family resolved (title_unknown gate)";
  } else if (breakdown.title_unknown > 0) {
    report.rootCause = "Reliability gate: title family mismatch or unknown candidate family";
  } else if (breakdown.signal_count > breakdown.insufficient_evidence) {
    report.rootCause = "Reliability/calibration gate: insufficient job match signals (signal_count < 2 or tier≥3 with signals < 3)";
  } else if (breakdown.insufficient_evidence > 0) {
    report.rootCause = "Credibility calibration insufficient_evidence (thin evidence on title-family tiers)";
  } else if (breakdown.insufficient_job_signals > 0) {
    report.rootCause = "Jobs lack resolvable match signals";
  } else {
    report.rootCause = "Unknown — review detailCounts";
  }

  const outPath = join(root, "scripts/audit/resume-fit-sean-failure-audit.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("\n=== Phase 5.2 Part A — Seán Resume Failure Audit ===\n");
  console.log(`Resume text length: ${report.resume.resumeTextLength}`);
  console.log(`Bullets: ${report.resume.bulletsCount}`);
  console.log(`Structured experience: ${report.resume.structuredExperienceCount}`);
  console.log(`Title family: ${report.titleDetection.candidateFamily ?? "null"} (${report.titleDetection.candidateSource ?? "no source"})`);
  console.log(`Years: ${report.experienceExtraction.candidateYears ?? "null"}`);
  console.log(`Seniority: ${report.seniorityExtraction.candidateLevel ?? "null"}`);
  console.log(`Unavailable breakdown:`, breakdown);
  console.log(`Root cause: ${report.rootCause}`);
  console.log(`\nSaved: ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
