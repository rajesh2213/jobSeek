/**
 * Read-only Phase 0 audit: client/server taxonomy divergence.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const require = createRequire(join(root, "apps/server/package.json"));

const { register } = await import("tsx/esm/api");
register();

const { listCanonicalIds, ALIASES_BY_CANONICAL } = await import(
  join(root, "packages/skill-constants/src/index.ts")
);
const { PrismaClient } = require("@prisma/client");

const tax = readFileSync(join(root, "apps/server/src/config/taxonomy.ts"), "utf8");
const serverCanon = [...new Set([...tax.matchAll(/canonical:\s*"([^"]+)"/g)].map((m) => m[1]))].sort();
const clientCanon = listCanonicalIds().sort();
const onlyServer = serverCanon.filter((c) => !clientCanon.includes(c));
const onlyClient = clientCanon.filter((c) => !serverCanon.includes(c));

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.job.findMany({
    where: { isActive: true, isPublishable: true, skills: { isEmpty: false } },
    select: { skills: true },
    take: 3000,
    orderBy: { listingFreshnessAt: "desc" },
  });

  let jobsWithServerOnlySkills = 0;
  const missedSkills = {};
  for (const row of rows) {
    let hasMiss = false;
    for (const s of row.skills) {
      const slug = s.toLowerCase();
      if (serverCanon.includes(slug) && !clientCanon.includes(slug)) {
        hasMiss = true;
        missedSkills[slug] = (missedSkills[slug] ?? 0) + 1;
      }
    }
    if (hasMiss) jobsWithServerOnlySkills++;
  }

  console.log(
    JSON.stringify(
      {
        clientCanonicalCount: clientCanon.length,
        serverCanonicalCount: serverCanon.length,
        sharedCount: clientCanon.filter((c) => serverCanon.includes(c)).length,
        onlyOnServer: onlyServer,
        onlyOnClient: onlyClient,
        clientAliasVariantCount: Object.values(ALIASES_BY_CANONICAL).flat().length,
        jobsWithServerOnlySkillsInSample3000: jobsWithServerOnlySkills,
        topMissedServerSkillsInJobTaxonomy: Object.entries(missedSkills)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 25),
      },
      null,
      2,
    ),
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
