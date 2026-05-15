/**
 * Read-only analysis: skill contamination before/after taxonomy fix.
 * Run: cd apps/server && npx tsx src/scripts/analyzeSkillContamination.ts
 */
import { Prisma } from "@prisma/client";
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import {
  DOMAIN_CONTRADICTION_TITLE_RE,
  SOFTWARE_ONLY_SKILL_SLUGS,
} from "../config/taxonomy.js";
import { enrichJob } from "../modules/enrichment/enrichment.service.js";
import {
  normalizeJobAttributes,
  normalizeSkills,
  filterSkillsByDomainContradiction,
} from "../utils/taxonomyNormalizer.js";
import { extractEnrichmentTechStack } from "@jobseek/skill-constants";

const SOFTWARE_ARR = [...SOFTWARE_ONLY_SKILL_SLUGS];

async function analyzeJobById(id: string): Promise<void> {
  const row = await prisma.job.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      category: true,
      skills: true,
      description: true,
      parsedDescription: true,
      enriched: true,
      updatedAt: true,
    },
  });
  if (!row) {
    console.log(JSON.stringify({ error: "job not found", id }));
    return;
  }
  const desc = row.description ?? "";
  const recomputed = normalizeJobAttributes({
    title: row.title,
    description: desc,
    isRemote: false,
  });
  const enr = row.parsedDescription ? enrichJob(row.parsedDescription) : null;
  const techFromDesc = extractEnrichmentTechStack(desc);
  const nextContexts: string[] = [];
  const re = /\bnext\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(desc)) !== null) {
    nextContexts.push(desc.slice(Math.max(0, m.index - 50), m.index + 55));
  }
  console.log(
    JSON.stringify(
      {
        id: row.id,
        title: row.title,
        category: row.category,
        storedSkills: row.skills,
        enrichedJson: row.enriched,
        enrichedTechFromParsedBuckets: enr?.techStack,
        techFromDescriptionEnrichmentScan: techFromDesc,
        taxonomyRecomputedSkills: recomputed.skills,
        nextWordInDescription: nextContexts,
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  loadRootEnv();

  const jobIdArg = process.argv[2];
  if (jobIdArg) {
    await analyzeJobById(jobIdArg);
    return;
  }

  const since20h = new Date(Date.now() - 20 * 60 * 60 * 1000);

  const [totalCanonical, contaminatedHealthcare, contaminatedByTitle, updatedLast20h] =
    await Promise.all([
      prisma.job.count({ where: { canonicalJobId: null, isActive: true } }),
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*)::bigint AS count
        FROM "Job" j
        WHERE j."canonicalJobId" IS NULL
          AND j."isActive" = true
          AND j.category = 'healthcare'
          AND j.skills && ARRAY[${Prisma.join(
            SOFTWARE_ARR.map((s) => Prisma.sql`${s}`),
          )}]::text[]
      `,
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*)::bigint AS count
        FROM "Job" j
        WHERE j."canonicalJobId" IS NULL
          AND j."isActive" = true
          AND j.title ~* ${DOMAIN_CONTRADICTION_TITLE_RE.source}
          AND j.skills && ARRAY[${Prisma.join(
            SOFTWARE_ARR.map((s) => Prisma.sql`${s}`),
          )}]::text[]
      `,
      prisma.job.count({
        where: {
          canonicalJobId: null,
          isActive: true,
          updatedAt: { gte: since20h },
        },
      }),
    ]);

  const phlebotomistSamples = await prisma.$queryRaw<
    Array<{
      id: string;
      title: string;
      skills: string[];
      updated_at: Date;
      category: string;
    }>
  >`
    SELECT j.id, j.title, j.skills, j."updatedAt" AS updated_at, j.category
    FROM "Job" j
    WHERE j."canonicalJobId" IS NULL
      AND j."isActive" = true
      AND j.title ILIKE '%phlebotom%'
    ORDER BY j."updatedAt" DESC
    LIMIT 15
  `;

  let wouldChange = 0;
  let sampled = 0;
  const batch = await prisma.job.findMany({
    where: {
      canonicalJobId: null,
      isActive: true,
      title: { contains: "phlebotom", mode: "insensitive" },
    },
    select: { id: true, title: true, description: true, isRemote: true, locationCity: true, skills: true },
    take: 200,
  });

  for (const row of batch) {
    sampled += 1;
    const attrs = normalizeJobAttributes({
      title: row.title,
      description: row.description ?? undefined,
      location: row.locationCity ?? undefined,
      isRemote: row.isRemote,
    });
    const cur = [...(row.skills ?? [])].sort().join(",");
    const next = [...attrs.skills].sort().join(",");
    if (cur !== next) wouldChange += 1;
  }

  const titleContaminated = await prisma.$queryRaw<
    Array<{ id: string; title: string; skills: string[]; updated_at: Date }>
  >`
    SELECT j.id, j.title, j.skills, j."updatedAt" AS updated_at
    FROM "Job" j
    WHERE j."canonicalJobId" IS NULL
      AND j."isActive" = true
      AND j.title ~* ${DOMAIN_CONTRADICTION_TITLE_RE.source}
      AND j.skills && ARRAY[${Prisma.join(
        SOFTWARE_ARR.map((s) => Prisma.sql`${s}`),
      )}]::text[]
    ORDER BY j."updatedAt" DESC
    LIMIT 10
  `;

  console.log(
    JSON.stringify(
      {
        analyzedAt: new Date().toISOString(),
        since20h: since20h.toISOString(),
        totalActiveCanonicalJobs: totalCanonical,
        jobsUpdatedLast20h: updatedLast20h,
        contaminatedHealthcareCategory: Number(contaminatedHealthcare[0]?.count ?? 0),
        contaminatedByOccupationTitle: Number(contaminatedByTitle[0]?.count ?? 0),
        phlebotomistSampleCount: phlebotomistSamples.length,
        phlebotomistSamples: phlebotomistSamples.map((r) => ({
          id: r.id,
          title: r.title.slice(0, 80),
          skills: r.skills,
          updatedAt: r.updated_at,
          category: r.category,
        })),
        backfillDryRun: {
          phlebotomistJobsSampled: sampled,
          wouldChangeSkills: wouldChange,
          unchanged: sampled - wouldChange,
        },
        titleContaminatedSamples: titleContaminated.map((r) => ({
          id: r.id,
          title: r.title.slice(0, 80),
          skills: r.skills,
          updatedAt: r.updated_at,
        })),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
