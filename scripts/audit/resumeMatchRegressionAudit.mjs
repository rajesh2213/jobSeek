/**
 * Phase 2.1: Compare Phase 1 (c2e84c8) vs Phase 2 (current) scorer on same corpus.
 * Run: cd apps/client && npx tsx ../../scripts/audit/resumeMatchRegressionAudit.mjs
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensurePhase1Snapshot } from "./lib/buildPhase1Snapshot.mjs";
import { classifyRegression } from "./lib/classifyRegression.mjs";
import { toDetailJobItem, toListJobItem } from "./lib/jobItemForAudit.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "apps/server/package.json"));
const { register } = await import("tsx/esm/api");
register();

const snapDir = ensurePhase1Snapshot();
const phase1 = await import(join(snapDir, "jobMatchSignals.ts"));
const phase2 = await import(join(root, "apps/client/lib/jobMatchSignals.ts"));
const { PrismaClient } = require("@prisma/client");

const SAMPLE = 2000;
const prisma = new PrismaClient();

function evaluate(scorer, job) {
  const resolution = scorer.resolveJobMatchSkillsWithMeta(job);
  const scorable = scorer.jobHasResolvableMatchSignals(job);
  return {
    scorable,
    signalCount: resolution.skills.length,
    skills: resolution.skills.map((s) => ({ canonical: s.canonical, source: s.source })),
    fitTier: resolution.fitTier,
    unavailableReason: resolution.unavailableReason,
  };
}

async function main() {
  const total = await prisma.job.count({ where: { isActive: true, isPublishable: true } });
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

  const regressions = [];
  const summary = {
    measuredAt: new Date().toISOString(),
    sampleSize: rows.length,
    totalActivePublishable: total,
    phase1Commit: "c2e84c8",
    phase1Unscorable: 0,
    phase2Unscorable: 0,
    phase1UnscorablePct: "0%",
    phase2UnscorablePct: "0%",
    scorableToUnavailable: 0,
    unavailableToScorable: 0,
    ontologyRegression: 0,
    strictFilterRegression: 0,
    descriptionFallbackRegression: 0,
    titleFamilyMismatch: 0,
    nonEnglish: 0,
    corruptData: 0,
    parserGap: 0,
    other: 0,
    corpusDriftNote: null,
  };

  for (const row of rows) {
    const detailJob = toDetailJobItem(row);
    const listJob = toListJobItem(row);

    const p1Detail = evaluate(phase1, detailJob);
    const p2Detail = evaluate(phase2, detailJob);
    const p1List = evaluate(phase1, listJob);
    const p2List = evaluate(phase2, listJob);

    if (!p1Detail.scorable) summary.phase1Unscorable++;
    if (!p2Detail.scorable) summary.phase2Unscorable++;

    if (p1Detail.scorable && !p2Detail.scorable) {
      summary.scorableToUnavailable++;
      const rootCause = classifyRegression({
        row,
        phase1: p1Detail,
        phase2: p2Detail,
        listPayload: listJob,
      });
      summary[rootCause === "strict_filter_regression" ? "strictFilterRegression" :
        rootCause === "ontology_regression" ? "ontologyRegression" :
        rootCause === "description_fallback_regression" ? "descriptionFallbackRegression" :
        rootCause === "title_family_mismatch" ? "titleFamilyMismatch" :
        rootCause === "non_english" ? "nonEnglish" :
        rootCause === "corrupt_data" ? "corruptData" :
        rootCause === "parser_gap" ? "parserGap" : "other"]++;

      if (regressions.length < 200) {
        regressions.push({
          jobId: row.id,
          title: row.title,
          company: row.company?.name,
          phase1Signals: p1Detail.skills,
          phase2Signals: p2Detail.skills,
          phase1SignalCount: p1Detail.signalCount,
          phase2SignalCount: p2Detail.signalCount,
          phase1ListScorable: p1List.scorable,
          phase2ListScorable: p2List.scorable,
          rootCause,
        });
      }
    }

    if (!p1Detail.scorable && p2Detail.scorable) {
      summary.unavailableToScorable++;
    }
  }

  summary.phase1UnscorablePct = `${((summary.phase1Unscorable / rows.length) * 100).toFixed(2)}%`;
  summary.phase2UnscorablePct = `${((summary.phase2Unscorable / rows.length) * 100).toFixed(2)}%`;

  const explained = summary.scorableToUnavailable > 0
    ? (summary.ontologyRegression +
        summary.strictFilterRegression +
        summary.descriptionFallbackRegression +
        summary.titleFamilyMismatch +
        summary.nonEnglish +
        summary.corruptData +
        summary.parserGap +
        summary.other) /
      summary.scorableToUnavailable
    : 1;

  summary.explainedPct = `${(explained * 100).toFixed(1)}%`;
  summary.corpusDriftNote =
    "Historical Phase 1 after-metrics (0.37%) was on 16940 jobs Jun 8. Current sample uses latest 2000 by freshness on expanded corpus.";

  const report = { summary, regressions };
  const outPath = join(root, "scripts/audit/resumeMatchRegressionAudit.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("\n=== Resume Match Regression Audit ===\n");
  console.log(`Sample: ${rows.length} / ${total} active`);
  console.log(`Phase 1 unscorable (detail): ${summary.phase1Unscorable} (${summary.phase1UnscorablePct})`);
  console.log(`Phase 2 unscorable (detail): ${summary.phase2Unscorable} (${summary.phase2UnscorablePct})`);
  console.log(`Scorable → Unavailable: ${summary.scorableToUnavailable}`);
  console.log(`Unavailable → Scorable: ${summary.unavailableToScorable}`);
  console.log(`\nRoot causes (scorable→unavailable):`);
  console.log(`  strict_filter_regression: ${summary.strictFilterRegression}`);
  console.log(`  ontology_regression: ${summary.ontologyRegression}`);
  console.log(`  description_fallback_regression: ${summary.descriptionFallbackRegression}`);
  console.log(`  title_family_mismatch: ${summary.titleFamilyMismatch}`);
  console.log(`  non_english: ${summary.nonEnglish}`);
  console.log(`  corrupt_data: ${summary.corruptData}`);
  console.log(`  parser_gap: ${summary.parserGap}`);
  console.log(`  other: ${summary.other}`);
  console.log(`  explained: ${summary.explainedPct}`);
  console.log(`\nSaved: ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
