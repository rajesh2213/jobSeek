/**
 * Manual validation: jobs containing target skills (Vue, Spring, Django, etc.)
 * Run: cd apps/client && npx tsx ../../scripts/audit/resumeMatchOntologyManualValidation.mjs
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "apps/server/package.json"));
const { register } = await import("tsx/esm/api");
register();

const { extractJobSkills } = await import(join(root, "apps/client/lib/skillExtractor.ts"));
const { resolveJobMatchSkillsWithMeta } = await import(
  join(root, "apps/client/lib/jobMatchSignals.ts")
);
const { PrismaClient } = require("@prisma/client");

const TARGETS = ["vue", "spring", "django", "salesforce", "recruiting", "agile", "excel"];
const prisma = new PrismaClient();

function emptyParsed() {
  return {
    position: [],
    responsibility: [],
    requirement: [],
    experience: [],
    benefit: [],
    contact: [],
    other: [],
  };
}

function toJobItem(row) {
  return {
    id: row.id,
    title: row.title ?? "",
    role: row.role,
    description: row.description ?? "",
    previewLines: [],
    skills: row.skills ?? [],
    parsedDescription: row.parsedDescription ?? emptyParsed(),
    enriched: row.enriched ?? null,
    company: { id: "x", name: "x", slug: "x" },
    location: "x",
    workMode: "onsite",
    employmentType: "full_time",
    postedAt: null,
  };
}

async function main() {
  const results = [];

  for (const skill of TARGETS) {
    const rows = await prisma.job.findMany({
      where: {
        isActive: true,
        isPublishable: true,
        skills: { has: skill },
      },
      select: { id: true, title: true, skills: true, company: { select: { name: true } } },
      take: 8,
      orderBy: { listingFreshnessAt: "desc" },
    });

    for (const row of rows) {
      const job = toJobItem(row);
      const extracted = extractJobSkills(job);
      const resolution = resolveJobMatchSkillsWithMeta(job);
      results.push({
        targetSkill: skill,
        jobId: row.id,
        title: row.title,
        company: row.company?.name,
        jobSkills: row.skills,
        resolvedSkills: extracted.map((s) => ({ canonical: s.canonical, source: s.source })),
        allSignals: resolution.skills.slice(0, 12).map((s) => s.canonical),
        confidence: resolution.confidence,
        fitTier: resolution.fitTier,
        detectsTarget: extracted.some((s) => s.canonical === skill),
      });
      if (results.length >= 50) break;
    }
    if (results.length >= 50) break;
  }

  const outPath = join(root, "scripts/audit/ontology-manual-validation.json");
  writeFileSync(outPath, JSON.stringify({ measuredAt: new Date().toISOString(), results }, null, 2));

  console.log(`\n=== Manual Validation (${results.length} jobs) ===\n`);
  for (const r of results.slice(0, 15)) {
    console.log(
      `${r.detectsTarget ? "✓" : "✗"} ${r.targetSkill} | ${r.title?.slice(0, 50)} | signals: ${r.allSignals.slice(0, 5).join(", ")}`,
    );
  }
  const detected = results.filter((r) => r.detectsTarget).length;
  console.log(`\nTarget detected: ${detected}/${results.length}`);
  console.log(`Saved: ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
