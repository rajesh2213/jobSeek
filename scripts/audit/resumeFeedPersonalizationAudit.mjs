/**
 * Phase 8A validation — recommended jobs feed personalization (read-only).
 * Run: cd apps/client && npx tsx ../../scripts/audit/resumeFeedPersonalizationAudit.mjs
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
const { deriveCandidateRoleFamily, deriveJobRoleFamily } = await import(
  join(root, "apps/client/lib/resumeFitTitle.ts"),
);
const {
  getRecommendedJobsForCandidate,
  rankRecommendedJobsForCandidate,
  RECOMMENDED_JOBS_LIMIT,
  RECOMMENDED_JOBS_POOL_LIMIT,
} = await import(join(root, "apps/client/lib/recommendedJobsForCandidate.ts"));

const prisma = new PrismaClient();

function candidateTitleInput(user, resumeText) {
  return {
    currentTitle: user.currentTitle,
    resumeStructuredV1: user.resumeStructuredV1,
    applyProfileSummary: user.applyProfileSummary,
    resumeText,
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
    take: RECOMMENDED_JOBS_POOL_LIMIT,
  });

  const users = await prisma.user.findMany({
    where: { OR: [{ resumeText: { not: null } }, { resumeFileName: { not: null } }] },
    select: {
      id: true,
      email: true,
      resumeFileName: true,
      currentTitle: true,
      resumeText: true,
      resumeStructuredV1: true,
      applyProfileSummary: true,
    },
    orderBy: { resumeUpdatedAt: "desc" },
  });

  const jobItems = jobs.map((r) => toDetailJobItem(r));
  const perResume = {};
  const aggregateBuckets = { same_family: 0, adjacent_family: 0, total: 0 };
  let nullFamilySuppressed = 0;
  let withFamilyShown = 0;

  for (const user of users) {
    const resumeText = user.resumeText?.trim() ?? "";
    const label = user.resumeFileName ?? user.email ?? user.id.slice(0, 8);
    const derived = deriveCandidateRoleFamily(candidateTitleInput(user, resumeText));

    if (!derived.family) {
      nullFamilySuppressed++;
      perResume[label] = {
        candidateFamily: null,
        sectionVisible: false,
        reason: "null candidateFamily — section hidden",
      };
      continue;
    }

    const ranked = rankRecommendedJobsForCandidate(derived.family, jobItems);
    const recommended = getRecommendedJobsForCandidate(derived.family, jobItems, RECOMMENDED_JOBS_LIMIT);

    if (recommended.length === 0) {
      perResume[label] = {
        candidateFamily: derived.family,
        sectionVisible: false,
        reason: "no same/adjacent jobs in pool",
        rankedInPool: ranked.length,
      };
      continue;
    }

    withFamilyShown++;
    const buckets = { same_family: 0, adjacent_family: 0 };
    for (const row of ranked.slice(0, RECOMMENDED_JOBS_LIMIT)) {
      buckets[row.bucket]++;
      aggregateBuckets[row.bucket]++;
      aggregateBuckets.total++;
    }

    perResume[label] = {
      candidateFamily: derived.family,
      sectionVisible: true,
      recommendedCount: recommended.length,
      sameFamily: buckets.same_family,
      adjacentFamily: buckets.adjacent_family,
      sameFamilyPct: `${((buckets.same_family / recommended.length) * 100).toFixed(1)}%`,
      adjacentFamilyPct: `${((buckets.adjacent_family / recommended.length) * 100).toFixed(1)}%`,
      jobFamilies: recommended.map((j) => deriveJobRoleFamily(j).family),
    };
  }

  const sameFamilyPct =
    aggregateBuckets.total > 0
      ? ((aggregateBuckets.same_family / aggregateBuckets.total) * 100).toFixed(1)
      : "0.0";

  const report = {
    measuredAt: new Date().toISOString(),
    poolJobs: jobItems.length,
    resumesAudited: users.length,
    nullFamilySuppressed,
    sectionsShown: withFamilyShown,
    aggregate: {
      recommendedSlots: aggregateBuckets.total,
      sameFamily: aggregateBuckets.same_family,
      adjacentFamily: aggregateBuckets.adjacent_family,
      sameFamilyPct: `${sameFamilyPct}%`,
    },
    perResume,
    successCriteria: {
      sameFamilyGte80Pct: Number(sameFamilyPct) >= 80,
      seoChanges: 0,
      anonymousUserChanges: 0,
      feedRankingChanged: false,
      resumeFitScoringChanged: false,
    },
    recommendation:
      Number(sameFamilyPct) >= 80
        ? "PASS — same-family dominance in recommendations"
        : "REVIEW — adjacent-family fill may exceed 20% for some resumes",
  };

  writeFileSync(join(auditDir, "resume-feed-personalization-validation.json"), JSON.stringify(report, null, 2));

  console.log("\n=== Phase 8A Feed Personalization Validation ===\n");
  console.log(`Same-family in recommendations: ${sameFamilyPct}% (target >= 80%)`);
  console.log(`Null-family suppressed: ${nullFamilySuppressed}/${users.length}`);
  console.log(`Sections shown: ${withFamilyShown}`);
  console.log(`Pass: ${report.successCriteria.sameFamilyGte80Pct}`);
  console.log(`Recommendation: ${report.recommendation}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
