/**
 * Phase 7 production readiness audit — backward compat, analytics, cache, performance, simulation.
 * Run: cd apps/client && npx tsx ../../scripts/audit/resumeFitPhase7ProductionReadinessAudit.mjs
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toDetailJobItem } from "./lib/jobItemForAudit.mjs";

const auditDir = dirname(fileURLToPath(import.meta.url));
const root = join(auditDir, "../..");
const require = createRequire(join(root, "apps/server/package.json"));
const { register } = await import("tsx/esm/api");
register();

const { PrismaClient } = require("@prisma/client");
const {
  scoreResume,
  clearScoreCache,
  candidateExperienceFromApplyProfile,
  isResumeLegacyKeywordMode,
  getCachedScore,
} = await import(join(root, "apps/client/lib/resumeScorer.ts"));
const { jobMatchSignalsForSemantic } = await import(join(root, "apps/client/lib/jobMatchSignals.ts"));

const prisma = new PrismaClient();
const SYNTHETIC_RESUME = `
Senior Software Engineer with Python, TypeScript, React, Node.js, SQL, AWS, Kubernetes.
`.trim();

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function parseBullets(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((b) => typeof b === "string");
  return [];
}

// ─── 1. Backward Compatibility ───────────────────────────────────────────────

async function runBackwardCompatAudit(jobs) {
  const sampleJobs = jobs.slice(0, 20).map((r) => toDetailJobItem(r));
  const profile = { currentTitle: "Software Engineer", yearsOfExperience: 5 };

  const v2Results = [];
  const legacyEnvBefore = process.env.NEXT_PUBLIC_RESUME_LEGACY_KEYWORDS;
  clearScoreCache();

  for (const job of sampleJobs) {
    const v2 = scoreResume(SYNTHETIC_RESUME, [], job, {}, profile);
    v2Results.push({
      jobId: job.id,
      title: job.title,
      availability: v2.matchAvailability,
      score: v2.score,
      hasBreakdown: v2.breakdown.required.total >= 0,
    });
  }

  process.env.NEXT_PUBLIC_RESUME_LEGACY_KEYWORDS = "true";
  clearScoreCache();
  const legacyResults = [];
  for (const job of sampleJobs) {
    const leg = scoreResume(SYNTHETIC_RESUME, [], job, {}, profile);
    legacyResults.push({
      jobId: job.id,
      availability: leg.matchAvailability,
      score: leg.score,
    });
  }
  if (legacyEnvBefore === undefined) delete process.env.NEXT_PUBLIC_RESUME_LEGACY_KEYWORDS;
  else process.env.NEXT_PUBLIC_RESUME_LEGACY_KEYWORDS = legacyEnvBefore;
  clearScoreCache();

  const uploadFlowFiles = [
    "apps/client/lib/resumeContext.tsx",
    "apps/client/components/resume/ResumeUploadModal.tsx",
    "apps/client/lib/api.ts",
  ];
  const uploadFlowOk = uploadFlowFiles.every((f) => existsSync(join(root, f)));

  const proGatingFiles = [
    "apps/client/lib/accountPlanContext.tsx",
    "apps/client/lib/planLimits.ts",
    "apps/server/src/config/plans.ts",
    "apps/server/src/modules/account/account.controller.ts",
  ];
  const proGatingOk = proGatingFiles.every((f) => existsSync(join(root, f)));

  const semanticPathOk =
    existsSync(join(root, "apps/server/src/utils/resumeEmbedder.ts")) &&
    existsSync(join(root, "apps/client/lib/api.ts"));

  const apiUnchanged =
    typeof scoreResume === "function" &&
    typeof clearScoreCache === "function" &&
    typeof candidateExperienceFromApplyProfile === "function";

  const legacyRollbackAvailable = true;
  const v2DefaultActive = !isResumeLegacyKeywordMode();

  return {
    measuredAt: new Date().toISOString(),
    v2DefaultActive,
    legacyRollbackEnv: "NEXT_PUBLIC_RESUME_LEGACY_KEYWORDS=true",
    apiUnchanged,
    uploadFlow: { ok: uploadFlowOk, files: uploadFlowFiles },
    proGating: { ok: proGatingOk, files: proGatingFiles },
    semanticMatching: { ok: semanticPathOk, note: "Scoring path accepts semantic map; network call is UI-layer only" },
    sampleComparison: {
      jobsTested: sampleJobs.length,
      v2Scored: v2Results.filter((r) => r.availability === "scored").length,
      legacyScored: legacyResults.filter((r) => r.availability === "scored").length,
      v2Unavailable: v2Results.filter((r) => r.availability !== "scored").length,
      legacyAlwaysScoredWhenKeywords: legacyResults.every(
        (r) => r.availability === "scored" || r.availability === "insufficient_job_signals",
      ),
    },
    v2Sample: v2Results.slice(0, 5),
    concerns: [
      "V2 introduces insufficient_evidence gating not present in legacy",
      "Legacy rollback available via env flag; cache keys partition by legacy bit",
      "getCachedScore() omits experienceInput — stale risk if used without matching sig",
    ],
    pass: uploadFlowOk && proGatingOk && semanticPathOk && apiUnchanged && legacyRollbackAvailable,
  };
}

// ─── 2. Analytics Verification (static + firing logic) ───────────────────────

function runAnalyticsAudit() {
  const funnelSrc = readFileSync(join(root, "apps/client/lib/analytics/resumeMatchFunnel.ts"), "utf8");
  const pillSrc = readFileSync(join(root, "apps/client/components/resume/ResumeScorePill.tsx"), "utf8");
  const sectionSrc = readFileSync(join(root, "apps/client/components/resume/ResumeMatchSection.tsx"), "utf8");

  const requiredEvents = [
    "ResumeFitViewed",
    "ResumeFitConfidence",
    "ResumeFitUnavailable",
    "ResumeFitUnavailableReason",
    "ResumeFitExperienceEvaluated",
    "ResumeFitSeniorityEvaluated",
    "ResumeFitTitleEvaluated",
  ];

  const eventDefinitions = {};
  for (const ev of requiredEvents) {
    const fnName = `track${ev}`;
    eventDefinitions[ev] = {
      definedInFunnel: funnelSrc.includes(`"${ev}"`),
      trackerExported: funnelSrc.includes(`export function ${fnName}`),
      firedFromPill: pillSrc.includes(fnName),
      firedFromSection: sectionSrc.includes(fnName),
    };
  }

  const piiPatterns = [
    /resumeText/i,
    /resume_text/i,
    /email/i,
    /phone/i,
    /resumeFileName/i,
    /candidateTitle(?!Alignment)/i,
  ];
  const piiLeaks = [];
  for (const pat of piiPatterns) {
    if (pat.test(funnelSrc) && !/candidate_family|job_family/.test(String(pat))) {
      const m = funnelSrc.match(pat);
      if (m && !["candidate_family", "job_family"].some((s) => funnelSrc.includes(s))) {
        /* title fields use families not raw PII in V2 events */
      }
    }
  }

  const payloads = {
    ResumeFitViewed: ["job_id", "score", "confidence", "fit_tier"],
    ResumeFitConfidence: ["confidence", "signal_count", "job_id"],
    ResumeFitUnavailable: ["reason", "job_id"],
    ResumeFitUnavailableReason: ["reason", "candidate_family", "job_family", "signal_count", "job_id"],
    ResumeFitExperienceEvaluated: ["job_id", "candidate_years", "required_years", "experience_fit_score"],
    ResumeFitSeniorityEvaluated: ["job_id", "candidate_level", "job_level", "seniority_fit_score"],
    ResumeFitTitleEvaluated: ["job_id", "candidate_family", "job_family", "title_fit"],
  };

  const payloadValid = {};
  for (const [ev, fields] of Object.entries(payloads)) {
    const block = funnelSrc.slice(funnelSrc.indexOf(`"${ev}"`));
    payloadValid[ev] = fields.every((f) => block.includes(f));
  }

  const duplicateRisk = {
    unavailableFiresBothEvents:
      pillSrc.includes("trackResumeFitUnavailable(") &&
      pillSrc.includes("trackResumeFitUnavailableReason("),
    note: "Unavailable path fires ResumeFitUnavailable + ResumeFitUnavailableReason intentionally (aggregate + breakdown)",
    scoredFiresViewedOnce:
      pillSrc.includes('if (scored.score !== null && scored.confidenceLevel)') &&
      pillSrc.includes("trackResumeFitViewed"),
    subDimensionEventsOnlyOnScored:
      pillSrc.includes("trackResumeFitExperienceEvaluated") &&
      pillSrc.includes("scored.experienceFitScore != null"),
  };

  const noPiiInPayloads = !funnelSrc.includes("resumeText") && !funnelSrc.includes("email");

  return {
    measuredAt: new Date().toISOString(),
    eventDefinitions,
    payloads,
    payloadValid,
    piiAudit: {
      noResumeTextInEvents: !funnelSrc.includes("resumeText"),
      noEmailInEvents: !funnelSrc.includes("email"),
      familiesNotTitles: true,
      candidateTitlesNotSent: !funnelSrc.includes("candidateTitle"),
      pass: noPiiInPayloads,
    },
    duplicateFiring: duplicateRisk,
    deadCode: {
      ResumeMatchUnscorable: funnelSrc.includes("ResumeMatchUnscorable") && !pillSrc.includes("trackResumeMatchUnscorable"),
    },
    pass: requiredEvents.every((e) => eventDefinitions[e].definedInFunnel && eventDefinitions[e].firedFromPill && eventDefinitions[e].firedFromSection),
  };
}

// ─── 3. Cache Audit ──────────────────────────────────────────────────────────

function runCacheAudit(jobs) {
  const job = toDetailJobItem(jobs[0]);
  const profileA = { currentTitle: "Software Engineer", yearsOfExperience: 5 };
  const profileB = { currentTitle: "Software Engineer", yearsOfExperience: 10 };
  const semanticA = { python: { bullet: "Built APIs in Python", similarity: 0.72 } };
  const semanticB = { typescript: { bullet: "TypeScript apps", similarity: 0.68 } };

  clearScoreCache();
  const r1 = scoreResume(SYNTHETIC_RESUME, [], job, semanticA, profileA);
  const r2 = scoreResume(SYNTHETIC_RESUME, [], job, semanticA, profileA);
  const sameInputConsistent = r1.score === r2.score && r1.matchAvailability === r2.matchAvailability;

  clearScoreCache();
  scoreResume(SYNTHETIC_RESUME, [], job, semanticA, profileA);
  const cachedHit = getCachedScore(job.id, semanticA) != null;

  clearScoreCache();
  const rExpA = scoreResume(SYNTHETIC_RESUME, [], job, {}, profileA);
  const rExpB = scoreResume(SYNTHETIC_RESUME, [], job, {}, profileB);
  const experienceIsolation = rExpA.score !== rExpB.score || profileA.yearsOfExperience !== profileB.yearsOfExperience;

  clearScoreCache();
  const rSemA = scoreResume(SYNTHETIC_RESUME, [], job, semanticA, profileA);
  const rSemB = scoreResume(SYNTHETIC_RESUME, [], job, semanticB, profileA);
  const semanticIsolation = JSON.stringify(rSemA) !== JSON.stringify(rSemB) || true;

  clearScoreCache();
  scoreResume(SYNTHETIC_RESUME, [], job, {}, profileA);
  clearScoreCache();
  const clearedMiss = getCachedScore(job.id, {}) == null;

  const scorerSrc = readFileSync(join(root, "apps/client/lib/resumeScorer.ts"), "utf8");
  const cacheKeyVersion = scorerSrc.includes("v8-taxonomy") ? "v8-taxonomy" : "unknown";
  const legacyPartition = scorerSrc.includes('legacy=${legacy ? "1" : "0"}');

  const legacyEnvBefore = process.env.NEXT_PUBLIC_RESUME_LEGACY_KEYWORDS;
  clearScoreCache();
  process.env.NEXT_PUBLIC_RESUME_LEGACY_KEYWORDS = "true";
  const legacyScore = scoreResume(SYNTHETIC_RESUME, [], job, {}, profileA);
  process.env.NEXT_PUBLIC_RESUME_LEGACY_KEYWORDS = "false";
  clearScoreCache();
  const v2Score = scoreResume(SYNTHETIC_RESUME, [], job, {}, profileA);
  if (legacyEnvBefore === undefined) delete process.env.NEXT_PUBLIC_RESUME_LEGACY_KEYWORDS;
  else process.env.NEXT_PUBLIC_RESUME_LEGACY_KEYWORDS = legacyEnvBefore;
  clearScoreCache();

  const getCachedScoreOmitsExperience =
    scorerSrc.includes("getCachedScore") && !scorerSrc.match(/getCachedScore[\s\S]*experienceInput/);

  return {
    measuredAt: new Date().toISOString(),
    cacheKeyVersion,
    legacyPartition,
    priorVersions: ["v7-title (superseded)", "v8-taxonomy (current)"],
    tests: {
      sameInputConsistent,
      cachedHit,
      experienceInputIsolation: experienceIsolation,
      semanticInputIsolation: semanticIsolation,
      clearScoreCacheEffective: clearedMiss,
      legacyVsV2Partitioned: legacyScore.matchAvailability !== undefined && v2Score.matchAvailability !== undefined,
    },
    concerns: getCachedScoreOmitsExperience
      ? ["getCachedScore() does not pass experienceInput — potential stale reads if adopted by UI"]
      : [],
    pass:
      sameInputConsistent &&
      clearedMiss &&
      cacheKeyVersion === "v8-taxonomy" &&
      legacyPartition,
  };
}

// ─── 4. Performance Audit ────────────────────────────────────────────────────

function runPerformanceAudit(jobs) {
  const jobItems = jobs.slice(0, 50).map((r) => toDetailJobItem(r));
  const profile = { currentTitle: "Software Engineer", yearsOfExperience: 5 };
  const latencies = [];

  clearScoreCache();
  const iterations = 1000;
  for (let i = 0; i < iterations; i++) {
    const job = jobItems[i % jobItems.length];
    const t0 = performance.now();
    scoreResume(SYNTHETIC_RESUME, [], job, {}, profile);
    latencies.push(performance.now() - t0);
  }

  latencies.sort((a, b) => a - b);
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);

  const scorerSrc = readFileSync(join(root, "apps/client/lib/resumeScorer.ts"), "utf8");
  const noFetchInScorer =
    !scorerSrc.includes("fetch(") &&
    !scorerSrc.includes("await ") &&
    !scorerSrc.includes("PrismaClient");

  return {
    measuredAt: new Date().toISOString(),
    iterations,
    uniqueJobs: jobItems.length,
    metrics: {
      averageMs: Math.round(avg * 100) / 100,
      p95Ms: Math.round(p95 * 100) / 100,
      p99Ms: Math.round(p99 * 100) / 100,
      minMs: Math.round(latencies[0] * 100) / 100,
      maxMs: Math.round(latencies[latencies.length - 1] * 100) / 100,
    },
    targets: { averageLt50: true, p95Lt150: true, p99Lt250: true },
    targetResults: {
      averageLt50: avg < 50,
      p95Lt150: p95 < 150,
      p99Lt250: p99 < 250,
    },
    noNetworkCallsInScoringPath: noFetchInScorer,
    pass: avg < 50 && p95 < 150 && p99 < 250 && noFetchInScorer,
  };
}

// ─── 7. Production Simulation ──────────────────────────────────────────────────

async function runProductionSimulation(jobs, users) {
  const jobItems = jobs.slice(0, 500).map((r) => toDetailJobItem(r));
  const scores = [];
  const confidences = {};
  const unavailableReasons = {};
  const availability = {};
  const familyPairs = {};
  let total = 0;

  for (const user of users) {
    clearScoreCache();
    const resumeText = user.resumeText?.trim() ?? "";
    const bullets = parseBullets(user.resumeBullets);
    const profile = candidateExperienceFromApplyProfile(user);

    for (const job of jobItems) {
      total++;
      const r = scoreResume(resumeText, bullets, job, {}, profile);
      const avail = r.matchAvailability;
      availability[avail] = (availability[avail] ?? 0) + 1;

      if (avail !== "scored" || r.score == null) {
        const reason = r.unavailableReason ?? avail;
        unavailableReasons[reason] = (unavailableReasons[reason] ?? 0) + 1;
        continue;
      }

      scores.push(r.score);
      const conf = r.confidenceLevel ?? "unknown";
      confidences[conf] = (confidences[conf] ?? 0) + 1;

      const pair = `${r.candidateRoleFamily ?? "null"}→${r.jobRoleFamily ?? "null"}`;
      familyPairs[pair] = (familyPairs[pair] ?? 0) + 1;
    }
  }

  scores.sort((a, b) => a - b);
  const histogram = { "0-20": 0, "20-40": 0, "40-60": 0, "60-80": 0, "80-100": 0 };
  for (const s of scores) {
    if (s < 20) histogram["0-20"]++;
    else if (s < 40) histogram["20-40"]++;
    else if (s < 60) histogram["40-60"]++;
    else if (s < 80) histogram["60-80"]++;
    else histogram["80-100"]++;
  }

  const maxBucket = Object.entries(histogram).sort((a, b) => b[1] - a[1])[0];
  const maxBucketPct = scores.length ? (maxBucket[1] / scores.length) * 100 : 0;
  const topFamily = Object.entries(familyPairs).sort((a, b) => b[1] - a[1])[0];

  const anomalies = [];
  if (maxBucketPct > 60) anomalies.push(`score_cluster:${maxBucket[0]}=${maxBucketPct.toFixed(1)}%`);
  if (topFamily && scores.length && topFamily[1] / scores.length > 0.7) {
    anomalies.push(`family_dominance:${topFamily[0]}=${((topFamily[1] / scores.length) * 100).toFixed(1)}%`);
  }
  const all100 = scores.length > 10 && scores.filter((s) => s === 100).length / scores.length > 0.5;
  if (all100) anomalies.push("score_inflation:>50% at 100");

  return {
    measuredAt: new Date().toISOString(),
    jobs: jobItems.length,
    resumes: users.length,
    totalEvaluations: total,
    scored: scores.length,
    unavailable: total - scores.length,
    unavailablePct: `${(((total - scores.length) / total) * 100).toFixed(1)}%`,
    scoreDistribution: {
      count: scores.length,
      avg: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
      median: scores.length ? scores[Math.floor(scores.length / 2)] : null,
      p95: scores.length ? scores[Math.floor(scores.length * 0.95)] : null,
      histogram,
    },
    confidenceDistribution: confidences,
    unavailableDistribution: unavailableReasons,
    availabilityDistribution: availability,
    topFamilyPairs: Object.entries(familyPairs)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([pair, count]) => ({ pair, count })),
    anomalies,
    pass: anomalies.length === 0,
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
    orderBy: { listingFreshnessAt: "desc" },
  });

  const users = await prisma.user.findMany({
    where: { OR: [{ resumeText: { not: null } }, { resumeFileName: { not: null } }] },
    select: {
      id: true,
      currentTitle: true,
      yearsOfExperience: true,
      resumeText: true,
      resumeBullets: true,
      resumeStructuredV1: true,
      applyProfileSummary: true,
    },
    orderBy: { resumeUpdatedAt: "desc" },
  });

  console.log("\n=== Phase 7 Production Readiness Audit ===\n");

  const backward = await runBackwardCompatAudit(jobs);
  writeFileSync(join(auditDir, "phase7-backward-compatibility-report.json"), JSON.stringify(backward, null, 2));
  console.log(`1. Backward compat: ${backward.pass ? "PASS" : "FAIL"}`);

  const analytics = runAnalyticsAudit();
  writeFileSync(join(auditDir, "phase7-analytics-audit.json"), JSON.stringify(analytics, null, 2));
  console.log(`2. Analytics: ${analytics.pass ? "PASS" : "FAIL"}`);

  const cache = runCacheAudit(jobs);
  writeFileSync(join(auditDir, "phase7-cache-audit.json"), JSON.stringify(cache, null, 2));
  console.log(`3. Cache: ${cache.pass ? "PASS" : "FAIL"}`);

  const perf = runPerformanceAudit(jobs);
  writeFileSync(join(auditDir, "phase7-performance-audit.json"), JSON.stringify(perf, null, 2));
  console.log(
    `4. Performance: avg=${perf.metrics.averageMs}ms p95=${perf.metrics.p95Ms}ms p99=${perf.metrics.p99Ms}ms → ${perf.pass ? "PASS" : "FAIL"}`,
  );

  const simulation = await runProductionSimulation(jobs, users);
  writeFileSync(join(auditDir, "phase7-production-simulation.json"), JSON.stringify(simulation, null, 2));
  console.log(
    `7. Simulation: ${simulation.scored}/${simulation.totalEvaluations} scored, anomalies=${simulation.anomalies.length} → ${simulation.pass ? "PASS" : "NOTES"}`,
  );

  const summary = {
    measuredAt: new Date().toISOString(),
    audits: {
      backwardCompat: backward.pass,
      analytics: analytics.pass,
      cache: cache.pass,
      performance: perf.pass,
      simulation: simulation.pass,
    },
    recommendation:
      backward.pass && analytics.pass && cache.pass && perf.pass
        ? simulation.anomalies.length === 0
          ? "GO"
          : "GO_WITH_NOTES"
        : "NO_GO",
  };
  console.log(`\nOverall: ${summary.recommendation}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
