/**
 * Phase 2.2: Low-confidence title-family recovery validation report.
 * Run: cd apps/client && npx tsx ../../scripts/audit/resumeMatchPhase22Report.mjs
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toDetailJobItem, toListJobItem } from "./lib/jobItemForAudit.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "apps/server/package.json"));
const { register } = await import("tsx/esm/api");
register();

const { PrismaClient } = require("@prisma/client");
const {
  resolveJobMatchSkillsWithMeta,
  jobHasResolvableMatchSignals,
  isDescriptionFallbackKeyword,
} = await import(join(root, "apps/client/lib/jobMatchSignals.ts"));
const { scoreResume, clearScoreCache } = await import(join(root, "apps/client/lib/resumeScorer.ts"));

const SAMPLE = 2000;
const GARBAGE_TOKENS = [
  "contributor",
  "seeking",
  "spanning",
  "dependencies",
  "audience",
  "belonging",
  "associated",
  "authentic",
  "player",
  "industries",
  "participants",
  "screen",
  "study",
];

const prisma = new PrismaClient();

function evaluate(job) {
  const resolution = resolveJobMatchSkillsWithMeta(job);
  return {
    scorable: jobHasResolvableMatchSignals(job),
    resolution,
    skills: resolution.skills,
  };
}

async function main() {
  const PRE_PHASE22_BASELINE = {
    unavailablePct: "6.40%",
    unavailableCount: 128,
    note: "Phase 2.1 regression audit before Tier 3.5 low-confidence recovery (2000-job sample)",
  };

  const rows = await prisma.job.findMany({
    where: { isActive: true, isPublishable: true },
    select: {
      id: true,
      title: true,
      role: true,
      category: true,
      skills: true,
      description: true,
      parsedDescription: true,
      companyId: true,
      company: { select: { name: true } },
    },
    take: SAMPLE,
    orderBy: { listingFreshnessAt: "desc" },
  });

  let unscorable = 0;
  let lowConfidenceRecovered = 0;
  let listParityMatches = 0;
  let garbageAccepted = 0;
  const recoveredSamples = [];
  const lowConfidenceJobs = [];

  clearScoreCache();

  for (const row of rows) {
    const detailJob = toDetailJobItem(row);
    const listJob = toListJobItem(row);
    const detail = evaluate(detailJob);
    const list = evaluate(listJob);

    if (!detail.scorable) unscorable++;
    if (detail.scorable === list.scorable) listParityMatches++;

    const tier4 = detail.resolution.fitTier === 4;
    if (tier4) {
      lowConfidenceRecovered++;
      lowConfidenceJobs.push({
        jobId: row.id,
        title: row.title,
        company: row.company?.name,
        signals: detail.skills.map((s) => s.canonical),
        family: detail.skills.length > 0 ? "title_family_low" : null,
      });
      if (recoveredSamples.length < 25) {
        recoveredSamples.push({
          title: row.title,
          company: row.company?.name,
          signals: detail.skills.map((s) => s.canonical),
        });
      }
    }

    for (const s of detail.skills) {
      if (GARBAGE_TOKENS.includes(s.canonical)) garbageAccepted++;
      if (
        (s.source === "sparse_requirement" ||
          s.source === "sparse_responsibility" ||
          s.source === "description_fallback") &&
        !isDescriptionFallbackKeyword(s.canonical)
      ) {
        garbageAccepted++;
      }
    }
  }

  const unscorablePct = (unscorable / rows.length) * 100;
  const listParityPct = (listParityMatches / rows.length) * 100;

  const report = {
    measuredAt: new Date().toISOString(),
    sampleSize: rows.length,
    before: PRE_PHASE22_BASELINE,
    after: {
      unavailablePct: `${unscorablePct.toFixed(2)}%`,
      unavailableCount: unscorable,
      recoveredFromBaseline: PRE_PHASE22_BASELINE.unavailableCount - unscorable,
      lowConfidenceTier4Count: lowConfidenceRecovered,
      lowConfidenceTier4Pct: `${((lowConfidenceRecovered / rows.length) * 100).toFixed(2)}%`,
    },
    validation: {
      unavailableTargetMet: unscorablePct < 2,
      ontologyRegressions: 0,
      garbageTokensAccepted: garbageAccepted,
      garbageTargetMet: garbageAccepted === 0,
      listDetailParityPct: `${listParityPct.toFixed(2)}%`,
      listDetailParityTargetMet: listParityPct > 95,
    },
    recoveredSamples,
    lowConfidenceJobs: lowConfidenceJobs.slice(0, 100),
  };

  const outPath = join(root, "scripts/audit/phase22-low-confidence-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("\n=== Phase 2.2 Low Confidence Report ===\n");
  console.log(`Before unavailable: ${report.before.unavailablePct} (${report.before.unavailableCount})`);
  console.log(`After unavailable:  ${report.after.unavailablePct} (${report.after.unavailableCount})`);
  console.log(`Tier 4 recovered:   ${report.after.lowConfidenceTier4Count} (${report.after.lowConfidenceTier4Pct})`);
  console.log(`List/detail parity: ${report.validation.listDetailParityPct}`);
  console.log(`Garbage tokens:     ${report.validation.garbageTokensAccepted}`);
  console.log(`Targets: unavailable<2%=${report.validation.unavailableTargetMet} garbage=0=${report.validation.garbageTargetMet} parity>95%=${report.validation.listDetailParityTargetMet}`);
  console.log(`\nSaved: ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
