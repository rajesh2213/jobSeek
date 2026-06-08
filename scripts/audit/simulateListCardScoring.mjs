import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "apps/server/package.json"));
const { register } = await import("tsx/esm/api");
register();

const { PrismaClient } = require("@prisma/client");
const { resolveJobMatchSkillsWithMeta } = await import(
  join(root, "apps/client/lib/jobMatchSignals.ts")
);
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

function simulateListPayload(row, previewLines) {
  return {
    id: row.id,
    title: row.title,
    role: row.role,
    description: previewLines.length > 0 ? null : row.description ?? "",
    previewLines,
    skills: row.skills ?? [],
    parsedDescription: undefined,
    enriched: undefined,
    company: { id: "x", name: "x", slug: "x" },
    location: "x",
    workMode: "onsite",
    employmentType: "full_time",
    postedAt: null,
  };
}

async function main() {
  const targetNames = process.argv.slice(2);
  const where = targetNames.length
    ? {
        isActive: true,
        OR: targetNames.flatMap((name) => [
          { title: { contains: name, mode: "insensitive" } },
          { company: { name: { contains: name, mode: "insensitive" } } },
        ]),
      }
    : { isActive: true, isPublishable: true };

  const recent = await prisma.job.findMany({
    where,
    select: {
      id: true,
      title: true,
      role: true,
      skills: true,
      description: true,
      parsedDescription: true,
      company: { select: { name: true } },
    },
    orderBy: { listingFreshnessAt: "desc" },
    take: 5,
  });

  for (const row of recent) {
    const preview = (row.description || "")
      .replace(/<[^>]+>/g, " ")
      .split(/\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 20)
      .slice(0, 3);

    const listJob = simulateListPayload(row, preview);
    const fullJob = {
      ...listJob,
      description: row.description ?? "",
      parsedDescription: row.parsedDescription ?? emptyParsed(),
      enriched: null,
    };

    const listRes = resolveJobMatchSkillsWithMeta(listJob);
    const fullRes = resolveJobMatchSkillsWithMeta(fullJob);

    console.log("---");
    console.log(row.title, "|", row.company?.name);
    console.log("skills:", row.skills?.length, "| desc words:", (row.description || "").split(/\s+/).length);
    console.log("LIST (what JobCard sends):", listRes.skills.length, "signals", listRes.fitTier, listRes.unavailableReason);
    console.log("FULL (detail page):", fullRes.skills.length, "signals", fullRes.fitTier, fullRes.unavailableReason);
  }
}

main()
  .finally(() => prisma.$disconnect());
