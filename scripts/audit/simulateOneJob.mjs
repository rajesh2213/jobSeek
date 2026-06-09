import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "apps/server/package.json"));
const { register } = await import("tsx/esm/api");
register();

const { resolveJobMatchSkillsWithMeta, jobHasResolvableMatchSignals } = await import(
  join(root, "apps/client/lib/jobMatchSignals.ts")
);
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const id = process.argv[2] ?? "2ba95c0b-624c-4bc9-921e-33081d236bc9";
const row = await prisma.job.findUnique({
  where: { id },
  select: { id: true, title: true, role: true, skills: true, description: true, parsedDescription: true },
});

const preview = (row.description || "").replace(/<[^>]+>/g, " ").trim().slice(0, 280);
const listJob = {
  id: row.id,
  title: row.title,
  role: row.role,
  skills: row.skills ?? [],
  description: preview.length >= 40 ? null : row.description,
  previewLines: preview.length >= 40 ? [preview] : [],
  parsedDescription: row.parsedDescription ?? null,
  enriched: undefined,
  company: { id: "x", name: "x", slug: "x" },
  location: "x",
  workMode: "onsite",
  employmentType: "full_time",
  postedAt: null,
  role: row.role ?? "",
};
const fullJob = {
  ...listJob,
  description: row.description,
  parsedDescription: row.parsedDescription,
  previewLines: preview.length >= 40 ? [preview] : [],
};

for (const [label, job] of [
  ["LIST", listJob],
  ["FULL", fullJob],
]) {
  const res = resolveJobMatchSkillsWithMeta(job);
  console.log(
    label,
    "scorable:",
    jobHasResolvableMatchSignals(job),
    "| signals:",
    res.skills.length,
    "| tier:",
    res.fitTier,
    "| reason:",
    res.unavailableReason,
  );
  console.log(
    "  top:",
    res.skills
      .slice(0, 10)
      .map((s) => `${s.canonical}(${s.source})`)
      .join(", ") || "(none)",
  );
}

await prisma.$disconnect();
