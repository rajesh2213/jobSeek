import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "apps/server/package.json"));
const { register } = await import("tsx/esm/api");
register();

const oldSrc = execSync("git show HEAD:apps/client/lib/jobMatchSignals.ts", {
  cwd: root,
  encoding: "utf8",
});
const oldPath = join(root, "scripts/audit/.oldJobMatchSignals.ts");
writeFileSync(oldPath, oldSrc);

const { resolveJobMatchSkills } = await import(oldPath);
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

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
  const names = ["UiPath", "Topsort", "LazyApply"];
  const rows = await prisma.job.findMany({
    where: {
      isActive: true,
      OR: names.flatMap((name) => [
        { company: { name: { contains: name, mode: "insensitive" } } },
      ]),
    },
    select: {
      id: true,
      title: true,
      role: true,
      skills: true,
      description: true,
      company: { select: { name: true } },
    },
    orderBy: { listingFreshnessAt: "desc" },
    take: 5,
  });

  for (const row of rows) {
    const preview = (row.description || "")
      .replace(/<[^>]+>/g, " ")
      .split(/\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 20)
      .slice(0, 3);
    const listJob = simulateListPayload(row, preview);
    const skills = resolveJobMatchSkills(listJob);
    console.log("---");
    console.log(row.company?.name, "|", row.title);
    console.log("previewLines:", preview.length, "| skills field:", row.skills?.length);
    console.log("OLD production signals:", skills.length, skills.length ? skills.slice(0, 5).map((s) => s.canonical) : "→ Match unavailable");
  }
}

main().finally(() => prisma.$disconnect());
