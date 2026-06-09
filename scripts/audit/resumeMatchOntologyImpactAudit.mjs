/**
 * Phase 2 impact: taxonomy skill detection before vs after ontology unification.
 * Run: cd apps/client && npx tsx ../../scripts/audit/resumeMatchOntologyImpactAudit.mjs
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "apps/server/package.json"));
const { register } = await import("tsx/esm/api");
register();

const { extractJobSkills } = await import(join(root, "apps/client/lib/skillExtractor.ts"));
const { getCanonicalsFromTextLine } = await import(
  join(root, "packages/skill-constants/src/index.ts")
);
const { KNOWN_SKILL_SLUGS } = await import(
  join(root, "packages/skill-constants/src/taxonomy.ts")
);
const { PrismaClient } = require("@prisma/client");

const SAMPLE = 1000;
const prisma = new PrismaClient();

const baseline = JSON.parse(
  readFileSync(join(root, "scripts/audit/ontology-gap-report-before.json"), "utf8"),
);
const onlyOnServer = new Set(baseline.ontology.onlyOnServer);
const onlyOnClient = new Set(baseline.ontology.onlyOnClient ?? []);
const OLD_CLIENT_CANON = new Set([
  ...KNOWN_SKILL_SLUGS.filter((c) => !onlyOnServer.has(c)),
  ...onlyOnClient,
]);

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
    company: { id: row.companyId, name: "x", slug: "x" },
    location: "x",
    workMode: "onsite",
    employmentType: "full_time",
    postedAt: null,
  };
}

function countTaxonomySkills(job, canonSet) {
  let n = 0;
  for (const s of job.skills ?? []) {
    const slug = String(s).toLowerCase().trim();
    if (canonSet.has(slug)) {
      n++;
      continue;
    }
    const hits = getCanonicalsFromTextLine(slug);
    if (hits.length > 0 && canonSet.has(hits[0].canonical)) n++;
  }
  return n;
}

async function main() {
  const rows = await prisma.job.findMany({
    where: { isActive: true, isPublishable: true },
    select: {
      id: true,
      title: true,
      role: true,
      skills: true,
      description: true,
      parsedDescription: true,
      enriched: true,
      companyId: true,
    },
    take: SAMPLE,
    orderBy: { listingFreshnessAt: "desc" },
  });

  const newCanon = new Set(KNOWN_SKILL_SLUGS);
  let additionalSkillsDetected = 0;
  let jobsImproved = 0;
  let totalBefore = 0;
  let totalAfter = 0;

  for (const row of rows) {
    const job = toJobItem(row);
    const before = countTaxonomySkills(job, OLD_CLIENT_CANON);
    const after = extractJobSkills(job).filter((s) => s.source === "taxonomy").length;

    totalBefore += before;
    totalAfter += after;
    if (after > before) {
      jobsImproved++;
      additionalSkillsDetected += after - before;
    }
  }

  const report = {
    measuredAt: new Date().toISOString(),
    sampleSize: rows.length,
    oldClientCanonicalCount: OLD_CLIENT_CANON.size,
    newClientCanonicalCount: newCanon.size,
    additionalSkillsDetected,
    jobsImproved,
    averageSkillCoverageBefore: Number((totalBefore / rows.length).toFixed(3)),
    averageSkillCoverageAfter: Number((totalAfter / rows.length).toFixed(3)),
    averageSkillCoverageDelta: Number(((totalAfter - totalBefore) / rows.length).toFixed(3)),
    jobsImprovedPct: `${((jobsImproved / rows.length) * 100).toFixed(1)}%`,
  };

  const outPath = join(root, "scripts/audit/ontology-impact-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("\n=== Ontology Impact Audit ===\n");
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nSaved: ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
