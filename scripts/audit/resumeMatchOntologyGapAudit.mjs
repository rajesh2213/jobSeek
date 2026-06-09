/**
 * Phase 2 baseline: measure server vs client skill ontology divergence on live jobs.
 * Run: cd apps/client && npx tsx ../../scripts/audit/resumeMatchOntologyGapAudit.mjs
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "apps/server/package.json"));
const { register } = await import("tsx/esm/api");
register();

const { KNOWN_SKILL_SLUGS, SKILL_ALIAS_MAP } = await import(
  join(root, "apps/server/src/config/taxonomy.ts")
);
const { listCanonicalIds, getCanonicalsFromTextLine } = await import(
  join(root, "packages/skill-constants/src/index.ts")
);
const { PrismaClient } = require("@prisma/client");

const SAMPLE_SIZE = 1000;
const prisma = new PrismaClient();
const serverCanon = [...KNOWN_SKILL_SLUGS].sort();
const clientCanon = listCanonicalIds().sort();
const clientSet = new Set(clientCanon);

function resolveClientVisible(skill) {
  const hits = getCanonicalsFromTextLine(skill);
  return hits.length > 0 ? hits[0].canonical : null;
}

async function main() {
  const totalJobs = await prisma.job.count({
    where: { isActive: true, isPublishable: true },
  });

  const rows = await prisma.job.findMany({
    where: { isActive: true, isPublishable: true },
    select: { id: true, skills: true },
    take: SAMPLE_SIZE,
    orderBy: { listingFreshnessAt: "desc" },
  });

  let jobsWithTaxonomySkills = 0;
  let jobsWithClientVisibleSkills = 0;
  let jobsWithHiddenServerSkills = 0;
  const missingSkillCounts = new Map();
  const missingAliasCounts = new Map();

  for (const row of rows) {
    const skills = row.skills ?? [];
    if (skills.length === 0) continue;
    jobsWithTaxonomySkills++;

    let hasClientVisible = false;
    let hasHidden = false;

    for (const raw of skills) {
      const slug = String(raw).toLowerCase().trim();
      if (!serverCanon.includes(slug)) continue;

      const clientResolved = resolveClientVisible(slug);
      if (clientResolved && clientSet.has(clientResolved)) {
        hasClientVisible = true;
      } else {
        hasHidden = true;
        missingSkillCounts.set(slug, (missingSkillCounts.get(slug) ?? 0) + 1);
        const alias = SKILL_ALIAS_MAP[slug] ?? slug;
        if (alias !== slug) {
          missingAliasCounts.set(slug, (missingAliasCounts.get(slug) ?? 0) + 1);
        }
      }
    }

    if (hasClientVisible) jobsWithClientVisibleSkills++;
    if (hasHidden) jobsWithHiddenServerSkills++;
  }

  const onlyServer = serverCanon.filter((c) => !clientSet.has(c));
  const onlyClient = clientCanon.filter((c) => !serverCanon.includes(c));

  const topMissingSkills = [...missingSkillCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([skill, count]) => ({ skill, count }));

  const topMissingAliases = [...missingAliasCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([alias, count]) => ({ alias, count }));

  const report = {
    measuredAt: new Date().toISOString(),
    sampleSize: SAMPLE_SIZE,
    totalActivePublishableJobs: totalJobs,
    ontology: {
      serverCanonicalCount: serverCanon.length,
      clientCanonicalCount: clientCanon.length,
      sharedCanonicalCount: serverCanon.filter((c) => clientSet.has(c)).length,
      divergenceCount: onlyServer.length + onlyClient.length,
      onlyOnServer: onlyServer,
      onlyOnClient: onlyClient,
      serverAliasCount: Object.keys(SKILL_ALIAS_MAP).length,
    },
    jobs: {
      sampled: rows.length,
      withTaxonomySkills: jobsWithTaxonomySkills,
      withClientVisibleSkills: jobsWithClientVisibleSkills,
      withHiddenServerSkills: jobsWithHiddenServerSkills,
      hiddenServerSkillsPct:
        jobsWithTaxonomySkills > 0
          ? `${((jobsWithHiddenServerSkills / jobsWithTaxonomySkills) * 100).toFixed(1)}%`
          : "0%",
    },
    topMissingSkills,
    topMissingAliases,
  };

  const outPath = join(root, "scripts/audit/ontology-gap-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("\n=== Resume Match Ontology Gap Audit ===\n");
  console.log(`Total jobs (active):     ${totalJobs}`);
  console.log(`Sampled:                 ${rows.length}`);
  console.log(`Server canonicals:       ${serverCanon.length}`);
  console.log(`Client canonicals:       ${clientCanon.length}`);
  console.log(`Jobs w/ taxonomy skills: ${jobsWithTaxonomySkills}`);
  console.log(`Jobs w/ client-visible:  ${jobsWithClientVisibleSkills}`);
  console.log(`Jobs w/ hidden server:   ${jobsWithHiddenServerSkills} (${report.jobs.hiddenServerSkillsPct} of jobs with skills)`);
  console.log(`\nTop missing skills:`);
  for (const { skill, count } of topMissingSkills.slice(0, 10)) {
    console.log(`  ${skill}: ${count}`);
  }
  console.log(`\nSaved: ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
