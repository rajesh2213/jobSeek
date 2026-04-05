/**
 * Snapshot first N jobs (same order as backfill), run the real CLI with --force --limit N, compare.
 *   npx tsx src/scripts/verifyLimitedBackfillRun.ts --limit 3
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";

loadRootEnv();

const limit = (() => {
  const i = process.argv.indexOf("--limit");
  if (i < 0) return 3;
  const n = Number(process.argv[i + 1]);
  if (!Number.isFinite(n) || n < 1) throw new Error("Invalid --limit");
  return Math.floor(n);
})();

function digest(pd: unknown): string {
  if (pd == null) return "null";
  const s = JSON.stringify(pd);
  const o = pd as Record<string, unknown>;
  const counts = Object.fromEntries(
    Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]),
  );
  return `${s.length}ch ${JSON.stringify(counts)}`;
}

async function snapshotRows(ids: string[]) {
  const out: { id: string; updatedAt: string; digest: string }[] = [];
  for (const id of ids) {
    const j = await prisma.job.findUnique({
      where: { id },
      select: { updatedAt: true, parsedDescription: true },
    });
    if (!j) throw new Error(`Missing job ${id}`);
    out.push({
      id,
      updatedAt: j.updatedAt.toISOString(),
      digest: digest(j.parsedDescription),
    });
  }
  return out;
}

const rows = await prisma.job.findMany({
  where: { canonicalJobId: null, description: { not: null } },
  orderBy: { id: "asc" },
  take: limit,
  select: { id: true },
});
const ids = rows.map((r) => r.id);
if (ids.length === 0) {
  console.log("No jobs matched.");
  await prisma.$disconnect();
  process.exit(0);
}

console.log("Job IDs (asc, same as backfill):", ids);

const before = await snapshotRows(ids);
console.log("\n--- BEFORE CLI backfill ---");
for (const b of before) {
  console.log(b.id, b.updatedAt, b.digest);
}

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
execSync(
  `npx tsx src/scripts/backfillParsedDescriptions.ts --force --limit ${limit}`,
  {
    cwd: serverRoot,
    stdio: "inherit",
    env: process.env,
    ...(process.platform === "win32"
      ? { shell: process.env.ComSpec ?? "cmd.exe" }
      : { shell: "/bin/sh" }),
  },
);

const after = await snapshotRows(ids);
console.log("\n--- AFTER CLI backfill ---");
for (const a of after) {
  console.log(a.id, a.updatedAt, a.digest);
}

console.log("\n--- Checks ---");
let allOk = true;
for (let i = 0; i < ids.length; i++) {
  const id = ids[i]!;
  const tChanged = before[i]!.updatedAt !== after[i]!.updatedAt;
  const dChanged = before[i]!.digest !== after[i]!.digest;
  if (!tChanged) allOk = false;
  const status = tChanged ? "ROW_TOUCHED" : "NO_DB_UPDATE";
  const sameParse = tChanged && !dChanged ? " (parsed JSON identical to before — normal if model is deterministic)" : "";
  console.log(
    id,
    status,
    `updatedAt changed: ${tChanged}, parse digest changed: ${dChanged}${sameParse}`,
  );
}
console.log(
  allOk
    ? "\nAll matched rows were written (updatedAt advanced). Backfill path is working."
    : "\nSome rows were not updated — inspect above.",
);

await prisma.$disconnect();
