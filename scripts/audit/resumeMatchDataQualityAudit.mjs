/**
 * Read-only Phase 0 audit: job data quality for match availability.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const require = createRequire(join(root, "apps/server/package.json"));
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const where = { isActive: true, isPublishable: true };
  const [total, noDesc, noParsed, emptySkills, emptyTitle] = await Promise.all([
    prisma.job.count({ where }),
    prisma.job.count({
      where: {
        ...where,
        OR: [{ description: null }, { description: "" }, { hasNonemptyDescription: false }],
      },
    }),
    prisma.job.count({ where: { ...where, parsedDescription: { equals: null } } }),
    prisma.job.count({ where: { ...where, skills: { isEmpty: true } } }),
    prisma.job.count({ where: { ...where, title: "" } }),
  ]);

  console.log(
    JSON.stringify(
      {
        totalActivePublishable: total,
        noDescription: noDesc,
        noDescriptionPct: `${((noDesc / total) * 100).toFixed(2)}%`,
        noParsedDescription: noParsed,
        noParsedDescriptionPct: `${((noParsed / total) * 100).toFixed(2)}%`,
        emptySkillsArray: emptySkills,
        emptySkillsPct: `${((emptySkills / total) * 100).toFixed(2)}%`,
        emptyTitle,
      },
      null,
      2,
    ),
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
