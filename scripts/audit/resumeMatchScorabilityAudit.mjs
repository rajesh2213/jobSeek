/**
 * Read-only Phase 0 audit: estimate job scorability rate.
 * Run: node scripts/audit/resumeMatchScorabilityAudit.mjs
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const require = createRequire(join(root, "apps/server/package.json"));

// Dynamic import client TS via tsx register
const { register } = await import("tsx/esm/api");
register();

const { PrismaClient } = require("@prisma/client");
const { jobHasResolvableMatchSignals, resolveJobMatchSkills } = await import(
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

function toJobItem(row) {
  const pd = row.parsedDescription;
  const enriched = row.enriched;
  return {
    id: row.id,
    title: row.title,
    role: row.role,
    skills: row.skills ?? [],
    parsedDescription: pd ?? emptyParsed(),
    enriched: enriched ?? null,
    company: { id: row.companyId, name: "x", slug: "x" },
    location: "x",
    workMode: "onsite",
    employmentType: "full_time",
    postedAt: row.postedAt?.toISOString?.() ?? null,
  };
}

async function main() {
  const rows = await prisma.job.findMany({
    where: { isActive: true, isPublishable: true },
    select: {
      id: true,
      title: true,
      role: true,
      skills: true,
      parsedDescription: true,
      enriched: true,
      companyId: true,
      postedAt: true,
      description: true,
      hasNonemptyDescription: true,
    },
    take: 5000,
    orderBy: { listingFreshnessAt: "desc" },
  });

  let unscorable = 0;
  let emptyTitle = 0;
  let emptyDesc = 0;
  const unscorableTitles = {};
  const signalTiers = { dictionary: 0, sparse: 0, roleHint: 0, mixed: 0 };

  for (const row of rows) {
    const job = toJobItem(row);
    if (!job.title?.trim()) {
      emptyTitle++;
      continue;
    }
    if (!row.description?.trim() && !row.hasNonemptyDescription) emptyDesc++;

    const skills = resolveJobMatchSkills(job);
    if (skills.length === 0) {
      unscorable++;
      const t = (job.title ?? "").slice(0, 60);
      unscorableTitles[t] = (unscorableTitles[t] ?? 0) + 1;
    } else {
      const sources = new Set(skills.map((s) => s.source));
      const hasDict = [...sources].some((s) =>
        ["taxonomy", "enriched", "parsed_requirement"].includes(s),
      );
      const hasSparse = [...sources].some((s) =>
        ["sparse_requirement", "sparse_responsibility"].includes(s),
      );
      const hasRole = sources.has("role_hint");
      if (hasDict && !hasSparse && !hasRole) signalTiers.dictionary++;
      else if (hasSparse && !hasRole) signalTiers.sparse++;
      else if (hasRole && !hasDict && !hasSparse) signalTiers.roleHint++;
      else signalTiers.mixed++;
    }
  }

  const total = rows.length;
  const pct = ((unscorable / total) * 100).toFixed(2);

  // Simulate Tier 3: title-only generic signals (proposed fallback)
  let tier3WouldSave = 0;
  for (const row of rows) {
    const job = toJobItem(row);
    if (!job.title?.trim()) continue;
    if (resolveJobMatchSkills(job).length > 0) continue;
    // Would become scorable with any non-empty title + description
    if (row.description?.trim() || row.hasNonemptyDescription) tier3WouldSave++;
  }

  console.log(
    JSON.stringify(
      {
        sampleSize: total,
        unscorable,
        unscorablePct: `${pct}%`,
        scorable: total - unscorable,
        emptyTitle,
        emptyDesc,
        signalTiers,
        tier3TitlePlusDescWouldSave: tier3WouldSave,
        tier3ProjectedUnscorablePct: `${(((unscorable - tier3WouldSave) / total) * 100).toFixed(2)}%`,
        topUnscorableTitles: Object.entries(unscorableTitles)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
