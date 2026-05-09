/**
 * Evidence: run the same hydrate shadow comparison as /internal/job-list/hydrate-shadow
 * without HTTP or JOB_LIST_SHADOW_SECRET. Uses DATABASE_URL from repo-root `.env`.
 *
 * Usage (from monorepo root):
 *   npx tsx apps/server/scripts/probe.jobListShadow.ts
 *   npx tsx apps/server/scripts/probe.jobListShadow.ts -- --limit=10
 *
 * Read-only on DB (extra hydrates only; no writes).
 */
import { PrismaClient } from "@prisma/client";
import { loadRootEnv } from "../src/infrastructure/env/loadEnv.js";
import type { JobDiscoveryFilters } from "../src/modules/job/job.repository.js";
import { runJobListHydrateShadow } from "../src/modules/job/jobListShadow.run.js";

loadRootEnv();

function argNum(prefix: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(prefix));
  if (!raw) return fallback;
  const n = parseInt(raw.slice(prefix.length), 10);
  return Number.isFinite(n) ? n : fallback;
}

const limit = Math.min(100, Math.max(1, argNum("--limit=", 20)));

const truncLens = [16000, 12000, 8000, 4000, 2000, 1200, 800];

const scenarios: Array<{
  name: string;
  filters?: JobDiscoveryFilters;
  sort: "latest" | "salary_desc";
  offset: number;
}> = [
  { name: "bare", sort: "latest", offset: 0 },
  { name: "category_engineering", filters: { category: "engineering" }, sort: "latest", offset: 0 },
  { name: "posted_1w", filters: { postedWithin: "1w" }, sort: "latest", offset: 0 },
  { name: "salary_sort", sort: "salary_desc", offset: 0 },
  { name: "page2_bare", sort: "latest", offset: limit },
];

type Row = {
  scenario: string;
  trunc: number;
  rowCount: number;
  queryIdsMs: number;
  baselineHydrateMs: number;
  truncHydrateMs: number;
  truncDeltaMs: number;
  omitHydrateMs: number;
  omitDeltaMs: number;
  basePrismaB: number;
  truncPrismaB: number;
  apiJsonB: number;
  truncJsonEqual: boolean;
  omitPatchedEqual: boolean;
  truncMismatch: string | null;
};

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const rows: Row[] = [];

  try {
    for (const sc of scenarios) {
      for (const trunc of truncLens) {
        const r = await runJobListHydrateShadow(prisma, {
          filters: sc.filters,
          sort: sc.sort,
          limit,
          offset: sc.offset,
          includeProcessing: false,
          truncChars: trunc,
        });

        const v = r.variants as {
          baseline?: { hydrateMs: number; approxPrismaBytes: number; approxApiJsonBytes: number };
          omitCompanyJobCount?: {
            hydrateMs: number;
            hydrateMsDeltaVsBaseline: number;
            jsonVsBaselineWhenPatchedWithBaselineCounts: { equal: boolean };
          };
          truncDescriptionSql?: {
            hydrateMs: number;
            hydrateMsDeltaVsBaseline: number;
            approxPrismaBytes: number;
            jsonVsBaseline: { equal: boolean; mismatchHint?: string | null };
          };
        };

        rows.push({
          scenario: sc.name,
          trunc,
          rowCount: r.rowCount,
          queryIdsMs: r.queryIdsMs,
          baselineHydrateMs: v.baseline?.hydrateMs ?? 0,
          truncHydrateMs: v.truncDescriptionSql?.hydrateMs ?? 0,
          truncDeltaMs: v.truncDescriptionSql?.hydrateMsDeltaVsBaseline ?? 0,
          omitHydrateMs: v.omitCompanyJobCount?.hydrateMs ?? 0,
          omitDeltaMs: v.omitCompanyJobCount?.hydrateMsDeltaVsBaseline ?? 0,
          basePrismaB: v.baseline?.approxPrismaBytes ?? 0,
          truncPrismaB: v.truncDescriptionSql?.approxPrismaBytes ?? 0,
          apiJsonB: v.baseline?.approxApiJsonBytes ?? 0,
          truncJsonEqual: v.truncDescriptionSql?.jsonVsBaseline?.equal === true,
          omitPatchedEqual:
            v.omitCompanyJobCount?.jsonVsBaselineWhenPatchedWithBaselineCounts?.equal === true,
          truncMismatch: v.truncDescriptionSql?.jsonVsBaseline?.mismatchHint ?? null,
        });
      }
    }

    /** Per scenario: smallest tested trunc (among truncLens ascending) with byte-identical list JSON vs baseline. */
    const minSafeTruncByScenario: Record<string, number | null> = {};
    for (const sc of scenarios) {
      let minTrunc: number | null = null;
      for (const t of [...truncLens].sort((a, b) => a - b)) {
        const hit = rows.find((x) => x.scenario === sc.name && x.trunc === t && x.truncJsonEqual);
        if (hit) {
          minTrunc = t;
          break;
        }
      }
      minSafeTruncByScenario[sc.name] = minTrunc;
    }

    const mins = scenarios.map((s) => minSafeTruncByScenario[s.name]);
    const conservativeListingDescPrefixChars =
      mins.every((m) => m != null) ? Math.max(...(mins as number[])) : null;

    const report = {
      limit,
      truncLens,
      scenarios: scenarios.map((s) => s.name),
      rows,
      minSafeTruncByScenario,
      /**
       * Single prefix length safe for all tested scenarios: max over scenarios of (min trunc with parity).
       * null if any scenario had no parity at any tested trunc.
       */
      conservativeListingDescPrefixChars,
      note:
        "conservativeListingDescPrefixChars = max over scenarios of (min trunc with truncJsonEqual). null if any scenario never matched.",
    };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
