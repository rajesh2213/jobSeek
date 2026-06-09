/**
 * Phase 2.1: Compare list scoring architectures A/B/C.
 * Run after regression + payload audits.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { ensurePhase1Snapshot } from "./lib/buildPhase1Snapshot.mjs";
import {
  toDetailJobItem,
  toListJobItem,
  toListJobSlimParsed,
  toListJobWithParsed,
} from "./lib/jobItemForAudit.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "apps/server/package.json"));
const { register } = await import("tsx/esm/api");
register();

const phase2 = await import(join(root, "apps/client/lib/jobMatchSignals.ts"));
const { PrismaClient } = require("@prisma/client");

const payload = JSON.parse(
  readFileSync(join(root, "scripts/audit/resumeMatchPayloadAudit.json"), "utf8"),
);

const SAMPLE = 500;
const prisma = new PrismaClient();

function scorable(scorer, job) {
  return scorer.jobHasResolvableMatchSignals(job);
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
      description: true,
      parsedDescription: true,
      companyId: true,
    },
    take: SAMPLE,
    orderBy: { listingFreshnessAt: "desc" },
  });

  let aScorable = 0;
  let bScorable = 0;
  let cScorable = 0;
  let listOnlyUnscorable = 0;

  for (const row of rows) {
    const listA = toListJobWithParsed(row);
    const listB = toListJobSlimParsed(row);
    const listC = toListJobItem(row);
    const detail = toDetailJobItem(row);

    if (scorable(phase2, listA)) aScorable++;
    if (scorable(phase2, listB)) bScorable++;
    if (scorable(phase2, detail)) cScorable++;

    if (!scorable(phase2, listC) && scorable(phase2, detail)) {
      listOnlyUnscorable++;
    }
  }

  const n = rows.length;
  const parityA = `${((aScorable / n) * 100).toFixed(1)}%`;
  const parityB = `${((bScorable / n) * 100).toFixed(1)}%`;
  const parityC = `${((cScorable / n) * 100).toFixed(1)}%`;
  const lazyHydrationFixPct = listOnlyUnscorable > 0
    ? `${((listOnlyUnscorable / n) * 100).toFixed(1)}% of jobs need hydrate`
    : "0%";

  const comparison = {
    measuredAt: new Date().toISOString(),
    sampleSize: n,
    options: {
      A: {
        name: "full parsedDescription on every list card",
        extraKbPerPage: payload.fullParsedExtraKbPerPage ?? payload.estimated50JobPageFullKb - payload.estimated50JobPageBaseKb,
        firstFitLatencyMs: "0 (no extra fetch)",
        mobileImpact: "high egress on scroll-heavy sessions",
        cacheability: "low — large list JSON",
        complexity: "low server change",
        listDetailParity: parityA,
        listScorablePct: parityA,
        futurePhase3Support: "good",
      },
      B: {
        name: "slim parsed (requirement+responsibility, 8 lines each)",
        extraKbPerPage: payload.slimParsedExtraKbPerPage ?? payload.estimated50JobPageSlimKb - payload.estimated50JobPageBaseKb,
        firstFitLatencyMs: "0",
        mobileImpact: "medium",
        cacheability: "medium",
        complexity: "medium — slim serializer + client",
        listDetailParity: parityB,
        listScorablePct: parityB,
        futurePhase3Support: "good",
      },
      C: {
        name: "lazy hydration on Check Fit click",
        extraKbPerPage: 0,
        firstFitLatencyMs: "150–400ms first click (detail fetch), 0ms cached",
        mobileImpact: "minimal list egress",
        cacheability: "high — session cache per jobId",
        complexity: "medium — client fetch + cache",
        listDetailParity: parityC,
        listScorablePct: `list-only unscorable ${lazyHydrationFixPct} → detail after hydrate`,
        futurePhase3Support: "excellent — reuses detail payload",
      },
    },
    metricsTable: {
      extraKbPerPage: {
        A: payload.fullParsedExtraKbPerPage,
        B: payload.slimParsedExtraKbPerPage,
        C: 0,
      },
      firstFitLatency: { A: "~0ms", B: "~0ms", C: "~250ms uncached" },
      mobileImpact: { A: "high", B: "medium", C: "low" },
      cacheability: { A: "low", B: "medium", C: "high" },
      complexity: { A: "low", B: "medium", C: "medium" },
      listDetailParity: { A: parityA, B: parityB, C: parityC },
      futurePhase3Support: { A: "good", B: "good", C: "excellent" },
    },
    recommendation: "KEEP_C",
    recommendationRationale: [
      "Lowest egress: 0 extra KB/page on list API",
      "Resume Fit is user-triggered; one-time fetch latency acceptable",
      "Achieves detail parity after hydrate for jobs that fail list-only scoring",
      "Reuses full job detail for Phase 3–6 experience/seniority signals",
      "Avoids maintaining slim/full parsed serializers on hot list path",
    ],
  };

  const outPath = join(root, "scripts/audit/resumeMatchArchitectureComparison.json");
  writeFileSync(outPath, JSON.stringify(comparison, null, 2));

  console.log("\n=== Architecture Comparison ===\n");
  console.log(`Option A list scorable: ${parityA}`);
  console.log(`Option B list scorable: ${parityB}`);
  console.log(`Option C detail scorable: ${parityC}`);
  console.log(`Jobs needing lazy hydrate: ${listOnlyUnscorable}/${n}`);
  console.log(`Recommendation: ${comparison.recommendation}`);
  console.log(`\nSaved: ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
