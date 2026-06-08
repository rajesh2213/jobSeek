/**
 * Phase 1 validation: scorability + tier breakdown.
 * Run: cd apps/client && npx tsx ../../scripts/audit/resumeMatchPhase1Validation.mjs [--baseline|--after]
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const require = createRequire(join(root, "apps/server/package.json"));
const { register } = await import("tsx/esm/api");
register();

const { PrismaClient } = require("@prisma/client");
const {
  jobHasResolvableMatchSignals,
  resolveJobMatchSkillsWithMeta,
} = await import(join(root, "apps/client/lib/jobMatchSignals.ts"));

const prisma = new PrismaClient();
const mode = process.argv.includes("--after") ? "after" : "baseline";

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
  const preview = buildPreviewLines(row);
  return {
    id: row.id,
    title: row.title ?? "",
    role: row.role,
    category: row.category,
    description: row.description ?? "",
    previewLines: preview,
    skills: row.skills ?? [],
    parsedDescription: row.parsedDescription ?? emptyParsed(),
    enriched: row.enriched ?? null,
    company: { id: row.companyId, name: "x", slug: "x" },
    location: "x",
    workMode: "onsite",
    employmentType: "full_time",
    postedAt: row.postedAt?.toISOString?.() ?? null,
  };
}

function stripHtml(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPreviewLines(row) {
  if (row.description?.trim()) {
    const t = stripHtml(row.description);
    if (t.length >= 40) {
      return [t.slice(0, Math.min(280, t.length))];
    }
  }
  return [];
}

async function main() {
  const rows = await prisma.job.findMany({
    where: { isActive: true, isPublishable: true },
    select: {
      id: true,
      title: true,
      role: true,
      category: true,
      skills: true,
      parsedDescription: true,
      enriched: true,
      description: true,
      companyId: true,
      postedAt: true,
      hasNonemptyDescription: true,
    },
    orderBy: { listingFreshnessAt: "desc" },
  });

  let scorable = 0;
  let unscorable = 0;
  const tierCounts = { tier1: 0, tier2: 0, tier3: 0, unavailable: 0 };
  const confidenceCounts = { high: 0, medium: 0, low: 0 };
  const unavailableReasons = {};
  const remainingUnavailable = [];

  for (const row of rows) {
    const job = toJobItem(row);
    const hasSignals = jobHasResolvableMatchSignals(job);
    if (hasSignals) {
      scorable++;
      const { fitTier, confidence } = resolveJobMatchSkillsWithMeta(job);
      if (fitTier === 1) tierCounts.tier1++;
      else if (fitTier === 2) tierCounts.tier2++;
      else if (fitTier === 3) tierCounts.tier3++;
      confidenceCounts[confidence]++;
    } else {
      unscorable++;
      tierCounts.unavailable++;
      const reason =
        !job.title?.trim()
          ? "empty_title"
          : !job.description?.trim()
            ? "empty_description"
            : "insufficient_signals";
      unavailableReasons[reason] = (unavailableReasons[reason] ?? 0) + 1;
      if (remainingUnavailable.length < 25) {
        remainingUnavailable.push({
          id: job.id,
          title: job.title,
          category: job.category,
          descriptionWords: (job.description || "").split(/\s+/).filter(Boolean).length,
          reason,
        });
      }
    }
  }

  const total = rows.length;
  const unscorablePct = ((unscorable / total) * 100).toFixed(2);
  const report = {
    mode,
    measuredAt: new Date().toISOString(),
    totalActivePublishable: total,
    scorable,
    unscorable,
    unscorablePct: `${unscorablePct}%`,
    tierBreakdown: tierCounts,
    confidenceBreakdown: confidenceCounts,
    unavailableReasons,
    topRemainingUnavailable: remainingUnavailable,
  };

  const outPath = join(root, `scripts/audit/phase1-${mode}-metrics.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`\n=== Phase 1 Validation (${mode}) ===\n`);
  console.log(`Total jobs:     ${total}`);
  console.log(`Scorable:       ${scorable} (${((scorable / total) * 100).toFixed(2)}%)`);
  console.log(`Unscorable:     ${unscorable} (${unscorablePct}%)`);
  console.log(`\nTier breakdown:`);
  console.log(`  Tier 1 (high):   ${tierCounts.tier1}`);
  console.log(`  Tier 2 (medium): ${tierCounts.tier2}`);
  console.log(`  Tier 3 (low):    ${tierCounts.tier3}`);
  console.log(`  Unavailable:     ${tierCounts.unavailable}`);
  console.log(`\nSaved: ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
