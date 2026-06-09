/**
 * Audit availability of experience fields for Phase 3.
 * Run: cd apps/client && npx tsx ../../scripts/audit/experienceFitDataAudit.mjs
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "apps/server/package.json"));
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const JOB_SAMPLE = 2000;
const USER_SAMPLE = 500;

const YEAR_RE =
  /\b(\d{1,2})\s*\+\s*years?\b|\b(\d{1,2})\s*-\s*(\d{1,2})\s*years?\b|\b(\d{1,2})\+?\s*years?\b/gi;

function linesWithYears(lines) {
  if (!Array.isArray(lines)) return 0;
  return lines.filter((l) => typeof l === "string" && YEAR_RE.test(l)).length;
}

function summaryYearsExp(summary) {
  if (!summary || typeof summary !== "object") return false;
  const y = summary.yearsExp;
  return typeof y === "number" && y > 0;
}

function structuredExperienceCount(structured) {
  if (!structured || typeof structured !== "object") return 0;
  const exp = structured.experience;
  return Array.isArray(exp) ? exp.length : 0;
}

async function main() {
  const [jobTotal, userTotal] = await Promise.all([
    prisma.job.count({ where: { isActive: true, isPublishable: true } }),
    prisma.user.count({
      where: {
        OR: [{ resumeText: { not: null } }, { resumeFileName: { not: null } }],
      },
    }),
  ]);

  const jobs = await prisma.job.findMany({
    where: { isActive: true, isPublishable: true },
    select: {
      id: true,
      title: true,
      experienceLevel: true,
      parsedDescription: true,
    },
    take: JOB_SAMPLE,
    orderBy: { listingFreshnessAt: "desc" },
  });

  const users = await prisma.user.findMany({
    where: {
      OR: [{ resumeText: { not: null } }, { resumeFileName: { not: null } }],
    },
    select: {
      id: true,
      yearsOfExperience: true,
      currentTitle: true,
      resumeStructuredV1: true,
      applyProfileSummary: true,
    },
    take: USER_SAMPLE,
    orderBy: { resumeUpdatedAt: "desc" },
  });

  let jobsWithExpLines = 0;
  let jobsWithReqYears = 0;
  let jobsWithExperienceLevel = 0;
  let jobsWithTitleSeniority = 0;

  for (const job of jobs) {
    const pd = job.parsedDescription;
    const expLines = linesWithYears(pd?.experience ?? []);
    const reqLines = linesWithYears(pd?.requirement ?? []);
    if (expLines > 0) jobsWithExpLines++;
    if (reqLines > 0) jobsWithReqYears++;
    if (job.experienceLevel) jobsWithExperienceLevel++;
    if (/\b(intern|junior|senior|lead|staff|principal|director|vp)\b/i.test(job.title ?? "")) {
      jobsWithTitleSeniority++;
    }
  }

  let usersYearsOfExperience = 0;
  let usersStructuredExp = 0;
  let usersSummaryYears = 0;
  let usersCurrentTitle = 0;

  for (const user of users) {
    if (user.yearsOfExperience != null && user.yearsOfExperience > 0) usersYearsOfExperience++;
    if (structuredExperienceCount(user.resumeStructuredV1) > 0) usersStructuredExp++;
    if (summaryYearsExp(user.applyProfileSummary)) usersSummaryYears++;
    if (user.currentTitle?.trim()) usersCurrentTitle++;
  }

  const report = {
    measuredAt: new Date().toISOString(),
    resume: {
      sampleSize: users.length,
      totalUsersWithResume: userTotal,
      yearsOfExperience: {
        available: usersYearsOfExperience,
        pct: `${((usersYearsOfExperience / users.length) * 100).toFixed(1)}%`,
      },
      resumeStructuredV1Experience: {
        available: usersStructuredExp,
        pct: `${((usersStructuredExp / users.length) * 100).toFixed(1)}%`,
      },
      applyProfileSummaryYearsExp: {
        available: usersSummaryYears,
        pct: `${((usersSummaryYears / users.length) * 100).toFixed(1)}%`,
      },
      currentTitle: {
        available: usersCurrentTitle,
        pct: `${((usersCurrentTitle / users.length) * 100).toFixed(1)}%`,
      },
    },
    job: {
      sampleSize: jobs.length,
      totalActivePublishable: jobTotal,
      parsedDescriptionExperienceLines: {
        withYearMentions: jobsWithExpLines,
        pct: `${((jobsWithExpLines / jobs.length) * 100).toFixed(1)}%`,
      },
      parsedDescriptionRequirementYears: {
        withYearMentions: jobsWithReqYears,
        pct: `${((jobsWithReqYears / jobs.length) * 100).toFixed(1)}%`,
      },
      experienceLevel: {
        available: jobsWithExperienceLevel,
        pct: `${((jobsWithExperienceLevel / jobs.length) * 100).toFixed(1)}%`,
      },
      titleSeniorityHeuristic: {
        available: jobsWithTitleSeniority,
        pct: `${((jobsWithTitleSeniority / jobs.length) * 100).toFixed(1)}%`,
      },
      anyJobYearsSignal: {
        count: jobs.filter((j) => {
          const pd = j.parsedDescription;
          return (
            linesWithYears(pd?.experience ?? []) > 0 ||
            linesWithYears(pd?.requirement ?? []) > 0 ||
            Boolean(j.experienceLevel) ||
            /\b(intern|junior|associate|senior|lead|staff|principal|architect|director|vp|engineer|manager)\b/i.test(
              j.title ?? "",
            )
          );
        }).length,
        pct: `${(
          (jobs.filter((j) => {
            const pd = j.parsedDescription;
            return (
              linesWithYears(pd?.experience ?? []) > 0 ||
              linesWithYears(pd?.requirement ?? []) > 0 ||
              Boolean(j.experienceLevel) ||
              /\b(intern|junior|associate|senior|lead|staff|principal|architect|director|vp|engineer|manager)\b/i.test(
                j.title ?? "",
              )
            );
          }).length /
            jobs.length) *
          100
        ).toFixed(1)}%`,
      },
    },
    phase3Readiness: {
      resumeYearsResolvableEstimate: `${Math.max(usersYearsOfExperience, usersStructuredExp, usersSummaryYears)} / ${users.length}`,
      jobYearsResolvableEstimate: "see job.anyJobYearsSignal",
    },
  };

  const outPath = join(root, "scripts/audit/experience-fit-data-audit.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nSaved: ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
