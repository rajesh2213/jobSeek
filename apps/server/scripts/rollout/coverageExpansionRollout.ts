/**
 * Safe phased coverage expansion rollout (production).
 *
 * Phases (skip with --phase=N or run subset with --only=bad-slugs,round2,tokens,collisions):
 *   1 bad-slugs   — revalidate 6 blocked cohort companies
 *   2 round2      — Class B token recovery (batch)
 *   3 activate-r2 — activate newly recovered Class B
 *   4 collisions  — M:N shared board links
 *   5 tokens      — wire has-token-no-active-endpoint (batch)
 *   6 metrics     — coverage snapshot
 *
 * Usage:
 *   cd apps/server && npx tsx scripts/rollout/coverageExpansionRollout.ts [--dry-run] [--limit=N]
 */
import { spawnSync } from "node:child_process";
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";

loadRootEnv();

const DRY_RUN = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? limitArg.split("=")[1] : "50";
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? onlyArg.split("=")[1]?.split(",") : null;

function run(label: string, script: string, extra: string[] = []): void {
  const args = ["tsx", script, ...(DRY_RUN ? ["--dry-run"] : []), ...extra];
  console.log(`\n>>> ${label}\n$ npx ${args.join(" ")}\n`);
  const res = spawnSync("npx", args, { stdio: "inherit", cwd: process.cwd() });
  if (res.status !== 0) {
    throw new Error(`Phase failed: ${label} (exit ${res.status})`);
  }
}

const phases: Array<{ key: string; label: string; script: string; extra?: string[] }> = [
  { key: "bad-slugs", label: "Phase 1 — Revalidate bad slug cohort", script: "scripts/migrations/revalidateBadSlugCohort.ts" },
  { key: "round2", label: "Phase 2 — Class B token recovery round 2", script: "scripts/migrations/recoverClassBTokens.ts", extra: [`--limit=${LIMIT}`] },
  { key: "activate-r2", label: "Phase 3 — Activate recovered Class B", script: "scripts/migrations/activateRecoveredClassB.ts", extra: [`--limit=${LIMIT}`] },
  { key: "collisions", label: "Phase 4 — Link shared board collisions", script: "scripts/migrations/linkSharedBoardCollisions.ts", extra: [`--limit=${LIMIT}`] },
  { key: "tokens", label: "Phase 5 — Activate token companies", script: "scripts/migrations/activateTokenCompanies.ts", extra: [`--limit=${LIMIT}`, "--delay-ms=250"] },
  { key: "metrics", label: "Phase 6 — Coverage metrics", script: "scripts/rollout/coverageOpportunitySnapshot.ts" },
];

async function main(): Promise<void> {
  console.log(`=== Coverage Expansion Rollout (${DRY_RUN ? "DRY RUN" : "LIVE"}) limit=${LIMIT} ===`);
  for (const p of phases) {
    if (ONLY && !ONLY.includes(p.key)) continue;
    run(p.label, p.script, p.extra ?? []);
  }
  console.log("\n=== Rollout complete ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
