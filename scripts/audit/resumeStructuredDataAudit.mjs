import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "apps/server/package.json"));
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const [withResume, withYears, withTitle, rows] = await Promise.all([
    prisma.user.count({ where: { resumeText: { not: null } } }),
    prisma.user.count({ where: { yearsOfExperience: { not: null } } }),
    prisma.user.count({ where: { currentTitle: { not: null } } }),
    prisma.user.findMany({
      where: { resumeStructuredV1: { not: null } },
      select: { resumeStructuredV1: true, yearsOfExperience: true, currentTitle: true },
      take: 200,
    }),
  ]);

  let withExperienceEntries = 0;
  let withDurationYears = 0;
  let withEducation = 0;
  let withStructuredSkills = 0;
  for (const row of rows) {
    const s = row.resumeStructuredV1;
    if (!s || typeof s !== "object") continue;
    if (Array.isArray(s.experience) && s.experience.length > 0) withExperienceEntries++;
    if (s.experience?.some((e) => e.durationYears != null)) withDurationYears++;
    if (Array.isArray(s.education) && s.education.length > 0) withEducation++;
    if (Array.isArray(s.skills) && s.skills.length > 0) withStructuredSkills++;
  }

  console.log(
    JSON.stringify(
      {
        usersWithResumeText: withResume,
        usersWithStructuredV1Sample: rows.length,
        usersWithYearsOfExperience: withYears,
        usersWithCurrentTitle: withTitle,
        structuredSampleStats: {
          withExperienceEntries,
          withDurationYears,
          withEducation,
          withStructuredSkills,
          sampleSize: rows.length,
        },
        clientResumeContextExposes: ["resumeText", "resumeBullets"],
        clientResumeContextMissing: [
          "resumeStructuredV1",
          "yearsOfExperience",
          "currentTitle",
        ],
      },
      null,
      2,
    ),
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
