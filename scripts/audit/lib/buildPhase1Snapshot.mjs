/**
 * Materialize Phase 1 (c2e84c8) scorer modules for audit comparisons.
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const snapDir = join(dirname(fileURLToPath(import.meta.url)), "../.snapshots/phase1");
const COMMIT = "c2e84c8";

const SKILL_FILES = ["dictionaryData.ts", "hash.ts", "enrichment.ts", "index.ts"];

function gitShow(path) {
  return execSync(`git show ${COMMIT}:${path}`, { cwd: root, encoding: "utf8" });
}

function fixImports(src) {
  return src.replace(/from "\.\/([^"]+)\.js"/g, 'from "./$1.ts"');
}

export function buildPhase1Snapshot() {
  if (existsSync(snapDir)) rmSync(snapDir, { recursive: true });
  mkdirSync(snapDir, { recursive: true });

  for (const f of SKILL_FILES) {
    writeFileSync(
      join(snapDir, f),
      fixImports(gitShow(`packages/skill-constants/src/${f}`)),
      "utf8",
    );
  }

  let signals = gitShow("apps/client/lib/jobMatchSignals.ts");
  signals = signals
    .replace('from "./api"', 'from "../../../../apps/client/lib/api.ts"')
    .replace('from "./resumeFitConfidence"', 'from "../../../../apps/client/lib/resumeFitConfidence.ts"')
    .replace('from "@jobseek/skill-constants"', 'from "./index.ts"')
    .replace('from "./resumeKeywordFilter"', 'from "../../../../apps/client/lib/resumeKeywordFilter.ts"')
    .replace('from "./skillExtractor"', 'from "../../../../apps/client/lib/skillExtractor.ts"');

  writeFileSync(join(snapDir, "jobMatchSignals.ts"), signals, "utf8");
  writeFileSync(join(snapDir, ".built"), COMMIT, "utf8");
  return snapDir;
}

export function ensurePhase1Snapshot() {
  const marker = join(snapDir, ".built");
  if (!existsSync(marker)) buildPhase1Snapshot();
  return snapDir;
}
