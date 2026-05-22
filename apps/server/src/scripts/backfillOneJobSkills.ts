/**
 * Recompute skills + enriched.techStack for one canonical job (production repair).
 * Run: cd apps/server && npx tsx src/scripts/backfillOneJobSkills.ts <jobId>
 */
import { Prisma } from "@prisma/client";
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { enrichJob } from "../modules/enrichment/enrichment.service.js";
import { deriveJobSkills } from "../utils/jobSkills.js";
import { logger } from "../utils/logger.js";

function jsonObjectOrEmpty(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

async function main(): Promise<void> {
  const jobId = process.argv[2]?.trim();
  if (!jobId) {
    console.error("Usage: npx tsx src/scripts/backfillOneJobSkills.ts <jobId>");
    process.exitCode = 1;
    return;
  }

  loadRootEnv();

  const row = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      title: true,
      description: true,
      isRemote: true,
      locationCity: true,
      category: true,
      skills: true,
      enriched: true,
      parsedDescription: true,
    },
  });

  if (!row) {
    console.error(JSON.stringify({ error: "job_not_found", jobId }));
    process.exitCode = 1;
    return;
  }

  const existingEnriched = jsonObjectOrEmpty(row.enriched);
  const computedEnriched = row.parsedDescription
    ? (enrichJob(row.parsedDescription) as unknown as Record<string, unknown>)
    : {};
  const mergedEnriched: Record<string, unknown> = {
    ...existingEnriched,
    ...computedEnriched,
  };

  const tech = computedEnriched.techStack;
  const techStack: string[] = Array.isArray(tech)
    ? tech.filter((x): x is string => typeof x === "string")
    : [];

  const newSkills = deriveJobSkills({
    title: row.title,
    description: row.description ?? undefined,
    location: row.locationCity ?? undefined,
    isRemote: row.isRemote,
    category: row.category,
    enrichmentTechStack: techStack,
  });

  await prisma.job.update({
    where: { id: jobId },
    data: {
      skills: newSkills,
      enriched: mergedEnriched as Prisma.InputJsonValue,
    },
  });

  const result = {
    event: "backfill_one_job_skills_done",
    jobId,
    title: row.title,
    before: {
      skills: row.skills,
      techStack: (existingEnriched.techStack as string[] | undefined) ?? [],
    },
    after: {
      skills: newSkills,
      techStack,
    },
  };

  logger.info(result, "backfill_one_job_skills_done");
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
