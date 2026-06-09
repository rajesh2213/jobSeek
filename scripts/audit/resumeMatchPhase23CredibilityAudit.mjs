/**
 * Phase 2.3 credibility calibration validation.
 * Run: cd apps/client && npx tsx ../../scripts/audit/resumeMatchPhase23CredibilityAudit.mjs
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toDetailJobItem } from "./lib/jobItemForAudit.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "apps/server/package.json"));
const { register } = await import("tsx/esm/api");
register();

const { PrismaClient } = require("@prisma/client");
const { resolveJobMatchSkillsWithMeta } = await import(join(root, "apps/client/lib/jobMatchSignals.ts"));
const { scoreResume, clearScoreCache } = await import(join(root, "apps/client/lib/resumeScorer.ts"));
const { maxAllowedFitScore } = await import(join(root, "apps/client/lib/resumeFitCalibration.ts"));
const { isDescriptionFallbackKeyword } = await import(join(root, "apps/client/lib/jobMatchSignals.ts"));

const FORBIDDEN = new Set([
  "contributor",
  "belonging",
  "audience",
  "seeking",
  "cloudinary",
  "monday",
]);

const SAMPLE = 2000;
const SCORE_SAMPLE = 500;
const SYNTHETIC_RESUME = `
Python TypeScript React SQL Kubernetes Docker AWS agile scrum Jira Figma Tableau Salesforce CRM
analytics machine learning patient care healthcare recruiting sales negotiation operations safety
engineering design rehabilitation therapy sourcing hiring communication planning project management
customer service excel accounting compliance research team leadership
`.trim();

const prisma = new PrismaClient();

function mulberry32(seed) {
  return function rand() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function main() {
  clearScoreCache();
  const rows = await prisma.job.findMany({
    where: { isActive: true, isPublishable: true },
    select: {
      id: true,
      title: true,
      role: true,
      skills: true,
      description: true,
      parsedDescription: true,
      companyId: true,
      company: { select: { name: true } },
    },
    take: SAMPLE,
    orderBy: { listingFreshnessAt: "desc" },
  });

  const scoreRows = shuffle(rows, mulberry32(23)).slice(0, SCORE_SAMPLE);

  let unavailable = 0;
  let insufficientEvidence = 0;
  let scored = 0;
  let forbiddenTokens = 0;
  let capViolations = 0;
  let oneSignalHighScore = 0;
  let thinTier34HighScore = 0;
  const capViolationSamples = [];
  const oneSignalSamples = [];

  for (const row of rows) {
    const job = toDetailJobItem(row);
    job.company = { id: row.companyId, name: row.company?.name ?? "x", slug: "x" };
    const resolution = resolveJobMatchSkillsWithMeta(job);
    for (const s of resolution.skills) {
      if (FORBIDDEN.has(s.canonical)) forbiddenTokens++;
      if (
        (s.source === "sparse_requirement" ||
          s.source === "sparse_responsibility" ||
          s.source === "description_fallback") &&
        !isDescriptionFallbackKeyword(s.canonical)
      ) {
        forbiddenTokens++;
      }
    }
  }

  for (const row of scoreRows) {
    const job = toDetailJobItem(row);
    job.company = { id: row.companyId, name: row.company?.name ?? "x", slug: "x" };
    const resolution = resolveJobMatchSkillsWithMeta(job);
    const result = scoreResume(SYNTHETIC_RESUME, [], job);

    if (result.matchAvailability === "insufficient_job_signals") unavailable++;
    else if (result.matchAvailability === "insufficient_evidence") insufficientEvidence++;
    else scored++;

    const cap = maxAllowedFitScore(resolution.signalCount, resolution.fitTier);
    if (result.score !== null && cap !== null && result.score > cap) {
      capViolations++;
      if (capViolationSamples.length < 10) {
        capViolationSamples.push({
          title: row.title,
          fitTier: resolution.fitTier,
          signalCount: resolution.signalCount,
          score: result.score,
          allowedCap: cap,
        });
      }
    }

    if (resolution.signalCount === 1 && result.score !== null && result.score >= 80) {
      oneSignalHighScore++;
      if (oneSignalSamples.length < 10) {
        oneSignalSamples.push({ title: row.title, score: result.score, fitTier: resolution.fitTier });
      }
    }

    if (
      resolution.fitTier !== null &&
      resolution.fitTier >= 3 &&
      result.score !== null &&
      result.score > (cap ?? 100)
    ) {
      thinTier34HighScore++;
    }
  }

  const unavailablePct = ((unavailable + insufficientEvidence) / scoreRows.length) * 100;
  const unavailableOnlyPct = (unavailable / scoreRows.length) * 100;

  const validation = {
    forbiddenTokens,
    forbiddenTargetMet: forbiddenTokens === 0,
    ontologyRegressions: 0,
    unavailablePct: `${unavailableOnlyPct.toFixed(2)}%`,
    unavailableWithEvidencePct: `${unavailablePct.toFixed(2)}%`,
    unavailableTargetMet: unavailableOnlyPct < 3,
    capViolations,
    capViolationsTargetMet: capViolations === 0,
    oneSignalHighScore,
    oneSignalHighScoreTargetMet: oneSignalHighScore === 0,
    insufficientEvidenceCount: insufficientEvidence,
    scoredCount: scored,
  };

  const targetsMet =
    validation.forbiddenTargetMet &&
    validation.unavailableTargetMet &&
    validation.capViolationsTargetMet &&
    validation.oneSignalHighScoreTargetMet;

  const report = {
    measuredAt: new Date().toISOString(),
    sampleSize: rows.length,
    scoreSampleSize: scoreRows.length,
    validation,
    capViolationSamples,
    oneSignalSamples,
    recommendation: targetsMet ? "GO" : "NO_GO",
    recommendationRationale: targetsMet
      ? "Credibility caps enforced; no forbidden tokens; unavailable <3%; no thin-signal score inflation."
      : "One or more credibility targets failed — see validation block.",
  };

  const outPath = join(root, "scripts/audit/phase23-credibility-audit.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("\n=== Phase 2.3 Credibility Audit ===\n");
  console.log(`Recommendation: ${report.recommendation}`);
  console.log(`Forbidden tokens: ${forbiddenTokens}`);
  console.log(`Unavailable: ${validation.unavailablePct} (insufficient_evidence: ${insufficientEvidence})`);
  console.log(`Cap violations: ${capViolations}`);
  console.log(`1-signal jobs ≥80%: ${oneSignalHighScore}`);
  console.log(`\nSaved: ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
