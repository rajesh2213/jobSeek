/**
 * Phase 8B — Recommendation funnel simulation (read-only).
 * Run: cd apps/client && npx tsx ../../scripts/audit/resumeFeedRecommendationFunnel.mjs
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
const { scoreResume, clearScoreCache, candidateExperienceFromApplyProfile } = await import(
  join(root, "apps/client/lib/resumeScorer.ts"),
);
const {
  deriveCandidateRoleFamily,
  deriveJobRoleFamily,
  titleFitRelation,
} = await import(join(root, "apps/client/lib/resumeFitTitle.ts"));
const {
  getRecommendedJobsForCandidate,
  rankRecommendedJobsForCandidate,
  RECOMMENDED_JOBS_LIMIT,
  RECOMMENDED_JOBS_POOL_LIMIT,
} = await import(join(root, "apps/client/lib/recommendedJobsForCandidate.ts"));

const prisma = new PrismaClient();
const MAIN_FEED_SAMPLE = 20;
const QUALITY_SAMPLE_PER_FAMILY = 50;
const QUALITY_FAMILIES = ["software.engineering", "marketing", "sales", "design", "operations"];

/** Directional CTR assumptions for pre-production funnel (no live Meta data yet). */
const MODELED_CTR = { same_family: 0.12, adjacent_family: 0.08 };
const MODELED_FIT_CHECK_RATE = 0.45;
const MODELED_APPLY_RATE = 0.22;

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

function bucketFor(candidateFamily, jobFamily) {
  if (!candidateFamily || !jobFamily) return "cross_family";
  const rel = titleFitRelation(candidateFamily, jobFamily);
  if (rel === "same") return "same_family";
  if (rel === "adjacent") return "adjacent_family";
  return "cross_family";
}

function evaluateFit(user, job, resumeText, bullets) {
  clearScoreCache();
  const profile = candidateExperienceFromApplyProfile(user);
  const scored = scoreResume(resumeText, bullets, job, {}, profile);
  return {
    availability: scored.matchAvailability,
    scored: scored.matchAvailability === "scored",
    score: scored.score,
    confidence: scored.confidenceLevel ?? null,
    unavailableReason: scored.unavailableReason ?? null,
    candidateFamily: scored.candidateRoleFamily ?? null,
    jobFamily: scored.jobRoleFamily ?? null,
  };
}

function aggregateFitMetrics(evaluations) {
  const total = evaluations.length;
  const scored = evaluations.filter((e) => e.scored);
  const unavailable = total - scored.length;
  const conf = { high: 0, medium: 0, low: 0, very_low: 0, null: 0 };
  let scoreSum = 0;
  for (const e of scored) {
    const c = e.confidence ?? "null";
    conf[c] = (conf[c] ?? 0) + 1;
    if (e.score != null) scoreSum += e.score;
  }
  return {
    evaluations: total,
    scored: scored.length,
    unavailable,
    availabilityPct: total ? `${((scored.length / total) * 100).toFixed(1)}%` : "0%",
    unavailablePct: total ? `${((unavailable / total) * 100).toFixed(1)}%` : "0%",
    avgScore: scored.length ? (scoreSum / scored.length).toFixed(1) : null,
    confidenceDistribution: conf,
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
      postedAt: true,
      listingFreshnessAt: true,
      createdAt: true,
    },
    orderBy: [{ postedAt: "desc" }, { listingFreshnessAt: "desc" }, { createdAt: "desc" }],
    take: 500,
  });

  const poolJobs = jobs.slice(0, RECOMMENDED_JOBS_POOL_LIMIT).map((r) => toDetailJobItem(r));
  const mainFeedJobs = poolJobs.slice(0, MAIN_FEED_SAMPLE);

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

  const funnelByBucket = {
    same_family: { views: 0, clicks: 0, fitChecks: 0, applications: 0 },
    adjacent_family: { views: 0, clicks: 0, fitChecks: 0, applications: 0 },
  };

  const structuralFunnel = {
    same_family: { views: 0, fitAvailableOnView: 0, fitUnavailableOnView: 0 },
    adjacent_family: { views: 0, fitAvailableOnView: 0, fitUnavailableOnView: 0 },
  };

  const perResumeLift = {};
  const mainFeedEvals = [];
  const recommendedEvals = [];

  for (const user of users) {
    clearScoreCache();
    const resumeText = user.resumeText?.trim() ?? "";
    const bullets = parseBullets(user.resumeBullets);
    const label = user.resumeFileName ?? user.email ?? user.id.slice(0, 8);
    const derived = deriveCandidateRoleFamily(candidateTitleInput(user, resumeText));
    if (!derived.family) continue;

    const recommended = getRecommendedJobsForCandidate(derived.family, poolJobs, RECOMMENDED_JOBS_LIMIT);
    const ranked = rankRecommendedJobsForCandidate(derived.family, poolJobs).slice(0, RECOMMENDED_JOBS_LIMIT);

    const mainEvals = mainFeedJobs.map((job) => evaluateFit(user, job, resumeText, bullets));
    const recEvals = recommended.map((job) => evaluateFit(user, job, resumeText, bullets));

    mainFeedEvals.push(...mainEvals);
    recommendedEvals.push(...recEvals);

    perResumeLift[label] = {
      candidateFamily: derived.family,
      mainFeed: aggregateFitMetrics(mainEvals),
      recommended: aggregateFitMetrics(recEvals),
      availabilityLiftPp:
        recEvals.length && mainEvals.length
          ? (
              (recEvals.filter((e) => e.scored).length / recEvals.length -
                mainEvals.filter((e) => e.scored).length / mainEvals.length) *
              100
            ).toFixed(1)
          : null,
    };

    for (const row of ranked) {
      const bucket = row.bucket;
      const fit = evaluateFit(user, row.job, resumeText, bullets);
      structuralFunnel[bucket].views++;
      if (fit.scored) structuralFunnel[bucket].fitAvailableOnView++;
      else structuralFunnel[bucket].fitUnavailableOnView++;

      funnelByBucket[bucket].views++;
      const ctr = MODELED_CTR[bucket];
      funnelByBucket[bucket].clicks += ctr;
      if (fit.scored) {
        funnelByBucket[bucket].fitChecks += ctr * MODELED_FIT_CHECK_RATE;
        funnelByBucket[bucket].applications += ctr * MODELED_FIT_CHECK_RATE * MODELED_APPLY_RATE;
      }
    }
  }

  const mainAgg = aggregateFitMetrics(mainFeedEvals);
  const recAgg = aggregateFitMetrics(recommendedEvals);
  const availMain = mainFeedEvals.length ? mainFeedEvals.filter((e) => e.scored).length / mainFeedEvals.length : 0;
  const availRec = recommendedEvals.length
    ? recommendedEvals.filter((e) => e.scored).length / recommendedEvals.length
    : 0;
  const liftPp = ((availRec - availMain) * 100).toFixed(1);

  const funnelReport = {
    measuredAt: new Date().toISOString(),
    methodology: {
      behavioral: "Modeled CTR/fit-check/apply rates — no production RecommendedJobs* events in DB yet",
      structural: "scoreResume on recommended vs main-feed job sets (actual Resume Fit V2)",
      ctrAssumptions: MODELED_CTR,
      fitCheckRate: MODELED_FIT_CHECK_RATE,
      applyRate: MODELED_APPLY_RATE,
    },
    funnel: {
      same_family: {
        ...funnelByBucket.same_family,
        structural: structuralFunnel.same_family,
        modeledCtrPct: `${(MODELED_CTR.same_family * 100).toFixed(0)}%`,
        fitAvailabilityOnClickPct:
          structuralFunnel.same_family.views > 0
            ? `${((structuralFunnel.same_family.fitAvailableOnView / structuralFunnel.same_family.views) * 100).toFixed(1)}%`
            : "0%",
      },
      adjacent_family: {
        ...funnelByBucket.adjacent_family,
        structural: structuralFunnel.adjacent_family,
        modeledCtrPct: `${(MODELED_CTR.adjacent_family * 100).toFixed(0)}%`,
        fitAvailabilityOnClickPct:
          structuralFunnel.adjacent_family.views > 0
            ? `${(
                (structuralFunnel.adjacent_family.fitAvailableOnView / structuralFunnel.adjacent_family.views) *
                100
              ).toFixed(1)}%`
            : "0%",
      },
    },
    aggregateModeledFunnel: {
      views: funnelByBucket.same_family.views + funnelByBucket.adjacent_family.views,
      clicks: +(funnelByBucket.same_family.clicks + funnelByBucket.adjacent_family.clicks).toFixed(2),
      fitChecks: +(funnelByBucket.same_family.fitChecks + funnelByBucket.adjacent_family.fitChecks).toFixed(2),
      applications: +(funnelByBucket.same_family.applications + funnelByBucket.adjacent_family.applications).toFixed(2),
      clickThroughRatePct:
        funnelByBucket.same_family.views + funnelByBucket.adjacent_family.views > 0
          ? `${(
              ((funnelByBucket.same_family.clicks + funnelByBucket.adjacent_family.clicks) /
                (funnelByBucket.same_family.views + funnelByBucket.adjacent_family.views)) *
              100
            ).toFixed(1)}%`
          : "0%",
    },
    perResume: perResumeLift,
    note: "Application stage uses PostHog job_apply_clicked in production — not yet attributed to recommended surface",
  };

  const availabilityLift = {
    measuredAt: new Date().toISOString(),
    comparison: {
      mainFeed: {
        label: `Top ${MAIN_FEED_SAMPLE} freshness-ordered jobs`,
        ...mainAgg,
      },
      recommendedSection: {
        label: `Up to ${RECOMMENDED_JOBS_LIMIT} family-boosted jobs per resume`,
        ...recAgg,
      },
    },
    lift: {
      availabilityPp: liftPp,
      availabilityRelativePct: availMain > 0 ? `${(((availRec - availMain) / availMain) * 100).toFixed(0)}%` : "n/a",
      avgScoreDelta:
        mainAgg.avgScore && recAgg.avgScore
          ? (Number(recAgg.avgScore) - Number(mainAgg.avgScore)).toFixed(1)
          : null,
      passes10PctLiftTarget: Number(liftPp) >= 10,
    },
    perResume: perResumeLift,
    goal: "Quantify Resume Fit availability lift from recommendation carousel vs main feed browse",
  };

  const qualityByFamily = {};
  const fullCatalog = jobs.map((r) => toDetailJobItem(r));

  for (const family of QUALITY_FAMILIES) {
    const ranked = rankRecommendedJobsForCandidate(family, fullCatalog).slice(0, QUALITY_SAMPLE_PER_FAMILY);
    const buckets = { same_family: 0, adjacent_family: 0, cross_family: 0 };
    const wrong = [];

    for (const row of ranked) {
      const rel = titleFitRelation(family, row.jobFamily);
      if (rel === "same") buckets.same_family++;
      else if (rel === "adjacent") buckets.adjacent_family++;
      else {
        buckets.cross_family++;
        wrong.push({
          jobId: row.job.id,
          title: row.job.title,
          jobFamily: row.jobFamily,
          relation: rel,
          reason: "cross_family in recommendation set — algorithm bug",
        });
      }
    }

    const total = ranked.length;
    qualityByFamily[family] = {
      sampleSize: total,
      sameFamilyPct: total ? `${((buckets.same_family / total) * 100).toFixed(1)}%` : "0%",
      adjacentFamilyPct: total ? `${((buckets.adjacent_family / total) * 100).toFixed(1)}%` : "0%",
      crossFamilyPct: total ? `${((buckets.cross_family / total) * 100).toFixed(1)}%` : "0%",
      wrongRecommendations: wrong,
      pass: buckets.cross_family === 0,
    };
  }

  const qualityAudit = {
    measuredAt: new Date().toISOString(),
    samplePerFamily: QUALITY_SAMPLE_PER_FAMILY,
    catalogJobs: fullCatalog.length,
    byFamily: qualityByFamily,
    aggregate: {
      totalSlots: Object.values(qualityByFamily).reduce((s, f) => s + f.sampleSize, 0),
      wrongCount: Object.values(qualityByFamily).reduce((s, f) => s + f.wrongRecommendations.length, 0),
      allFamiliesPass: Object.values(qualityByFamily).every((f) => f.pass),
    },
  };

  writeFileSync(join(auditDir, "phase8b-funnel-report.json"), JSON.stringify(funnelReport, null, 2));
  writeFileSync(join(auditDir, "phase8b-availability-lift.json"), JSON.stringify(availabilityLift, null, 2));
  writeFileSync(join(auditDir, "phase8b-quality-audit.json"), JSON.stringify(qualityAudit, null, 2));

  console.log("\n=== Phase 8B Funnel & Lift ===\n");
  console.log(`Availability lift: ${liftPp}pp (target >= 10pp)`);
  console.log(`Main feed: ${mainAgg.availabilityPct} | Recommended: ${recAgg.availabilityPct}`);
  console.log(`Modeled CTR: ${funnelReport.aggregateModeledFunnel.clickThroughRatePct}`);
  console.log(`Quality wrong recs: ${qualityAudit.aggregate.wrongCount}`);
  console.log(`Lift passes 10%: ${availabilityLift.lift.passes10PctLiftTarget}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
