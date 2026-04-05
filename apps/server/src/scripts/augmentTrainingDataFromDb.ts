/**
 * Augment training-data.json with heuristic-labeled lines from real Job.description rows.
 *
 * Run: npx tsx src/scripts/augmentTrainingDataFromDb.ts
 *      npx tsx src/scripts/augmentTrainingDataFromDb.ts --jobs=1500 --dry-run
 *
 * Append newest jobs (createdAt desc). Caps NEW lines per label so the file stays usable
 * (override with --append-unlimited or raise --append-max-per-label / --append-max-other).
 *   npx tsx src/scripts/augmentTrainingDataFromDb.ts --append --jobs=8000
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { preprocessDescription } from "../modules/ai/preprocessDescription.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT = path.join(__dirname, "training-data.json");

const MIN_CHARS = 20;
const MAX_CHARS = 200;

interface TrainingSample {
  text: string;
  label: string;
}

const LABEL_ORDER = [
  "responsibility",
  "requirement",
  "benefit",
  "experience",
  "contact",
  "other",
] as const;

type HeuristicLabel = (typeof LABEL_ORDER)[number];

const EMAIL_RE = /\b[\w.%+-]+@[A-Za-z0-9][\w.-]*\.[A-Za-z]{2,}\b/;

/** Years-style experience (checked before generic "experience" requirement). */
const EXPERIENCE_RE =
  /\b\d+\s*\+\s*years?\b|\b\d+\s*-\s*\d+\s*years?\b|\b\d+\s+years?\b|\byears?\s+of\s+experience\b/i;

const BENEFIT_RE = /\b(benefits?|insurance|salary|bonus|perks?)\b/i;

const RESPONSIBILITY_RE = /\b(build|develop|design|implement|manage|optimize)\b/i;

const REQUIREMENT_RE = /\b(experience|years|must|required|knowledge)\b/i;

function heuristicLabel(line: string): HeuristicLabel {
  const t = line.trim();
  if (EMAIL_RE.test(t) || /\bapply\b/i.test(t) || /mailto:/i.test(t)) {
    return "contact";
  }
  if (EXPERIENCE_RE.test(t)) {
    return "experience";
  }
  if (BENEFIT_RE.test(t)) {
    return "benefit";
  }
  if (RESPONSIBILITY_RE.test(t)) {
    return "responsibility";
  }
  if (REQUIREMENT_RE.test(t)) {
    return "requirement";
  }
  return "other";
}

function dedupeKey(s: TrainingSample): string {
  return `${s.label}\t${s.text.toLowerCase().trim()}`;
}

function dedupe(samples: TrainingSample[]): TrainingSample[] {
  const seen = new Set<string>();
  const out: TrainingSample[] = [];
  for (const s of samples) {
    const k = dedupeKey(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

/** Equal cap per structured label; allow more `other`. */
function balanceByLabel(samples: TrainingSample[]): TrainingSample[] {
  const pools = new Map<string, TrainingSample[]>();
  for (const l of LABEL_ORDER) {
    pools.set(l, []);
  }
  for (const s of samples) {
    if (!LABEL_ORDER.includes(s.label as HeuristicLabel)) continue;
    pools.get(s.label)?.push(s);
  }

  const nonOther = LABEL_ORDER.filter((l) => l !== "other");
  const counts = nonOther.map((l) => pools.get(l)?.length ?? 0).filter((n) => n > 0);
  if (counts.length === 0) {
    const o = pools.get("other") ?? [];
    shuffleInPlace(o);
    return o.slice(0, Math.min(20_000, o.length));
  }

  let n = Math.min(...counts);
  n = Math.min(n, 8000);
  n = Math.max(n, 80);

  const out: TrainingSample[] = [];
  for (const l of nonOther) {
    const pool = [...(pools.get(l) ?? [])];
    shuffleInPlace(pool);
    out.push(...pool.slice(0, Math.min(pool.length, n)));
  }

  const otherPool = [...(pools.get("other") ?? [])];
  shuffleInPlace(otherPool);
  const otherTake = Math.min(otherPool.length, n * 3);
  out.push(...otherPool.slice(0, otherTake));

  shuffleInPlace(out);
  return out;
}

/** Cap pooled lines for append mode (structured labels + other). */
function capAppendPools(
  samples: TrainingSample[],
  maxPerStructured: number,
  maxOther: number,
): TrainingSample[] {
  const pools = new Map<string, TrainingSample[]>();
  for (const l of LABEL_ORDER) pools.set(l, []);
  for (const s of samples) {
    pools.get(s.label)?.push(s);
  }
  const nonOther = LABEL_ORDER.filter((l) => l !== "other");
  const out: TrainingSample[] = [];
  for (const l of nonOther) {
    const pool = [...(pools.get(l) ?? [])];
    shuffleInPlace(pool);
    out.push(...pool.slice(0, Math.min(pool.length, maxPerStructured)));
  }
  const otherPool = [...(pools.get("other") ?? [])];
  shuffleInPlace(otherPool);
  out.push(...otherPool.slice(0, Math.min(otherPool.length, maxOther)));
  return dedupe(out);
}

function parseArgs(): {
  jobs: number;
  dryRun: boolean;
  append: boolean;
  appendUnlimited: boolean;
  appendMaxPerLabel: number;
  appendMaxOther: number;
} {
  let jobs = 1200;
  let dryRun = false;
  let append = false;
  let appendUnlimited = false;
  let appendMaxPerLabel = 6000;
  let appendMaxOther = 14_000;
  for (const a of process.argv.slice(2)) {
    if (a === "--dry-run") dryRun = true;
    if (a === "--append") append = true;
    if (a === "--append-unlimited") appendUnlimited = true;
    const m = a.match(/^--jobs=(\d+)$/);
    if (m) jobs = Math.min(50_000, Math.max(50, parseInt(m[1]!, 10)));
    const mpl = a.match(/^--append-max-per-label=(\d+)$/);
    if (mpl) appendMaxPerLabel = Math.min(100_000, Math.max(100, parseInt(mpl[1]!, 10)));
    const mo = a.match(/^--append-max-other=(\d+)$/);
    if (mo) appendMaxOther = Math.min(200_000, Math.max(100, parseInt(mo[1]!, 10)));
  }
  return { jobs, dryRun, append, appendUnlimited, appendMaxPerLabel, appendMaxOther };
}

const VALID_LABELS = new Set([
  "responsibility",
  "requirement",
  "benefit",
  "experience",
  "contact",
  "position",
  "other",
]);

async function main(): Promise<void> {
  loadRootEnv();
  const { jobs, dryRun, append, appendUnlimited, appendMaxPerLabel, appendMaxOther } =
    parseArgs();

  const rows = await prisma.job.findMany({
    where: { canonicalJobId: null, description: { not: null } },
    select: { description: true },
    orderBy: append ? { createdAt: "desc" } : { updatedAt: "desc" },
    take: jobs,
  });

  const raw: TrainingSample[] = [];
  for (const row of rows) {
    const desc = row.description?.trim();
    if (!desc) continue;
    for (const line of preprocessDescription(desc)) {
      const t = line.trim();
      if (t.length < MIN_CHARS || t.length > MAX_CHARS) continue;
      const label = heuristicLabel(t);
      raw.push({ text: t, label });
    }
  }

  const rawDeduped = dedupe(raw);
  let augmented: TrainingSample[];
  if (append) {
    augmented =
      appendUnlimited ?
        rawDeduped
      : capAppendPools(rawDeduped, appendMaxPerLabel, appendMaxOther);
  } else {
    augmented = balanceByLabel(rawDeduped);
  }

  const existingRaw = await readFile(OUTPUT, "utf8");
  const existingParsed = JSON.parse(existingRaw) as unknown;
  if (!Array.isArray(existingParsed)) {
    throw new Error("training-data.json must be an array");
  }

  const existing: TrainingSample[] = [];
  for (const row of existingParsed) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const text = typeof r.text === "string" ? r.text : "";
    const label = typeof r.label === "string" ? r.label : "";
    if (text && label && VALID_LABELS.has(label)) existing.push({ text, label });
  }

  const existingKeys = new Set(existing.map(dedupeKey));
  const netNew = augmented.filter((s) => !existingKeys.has(dedupeKey(s)));

  const merged = dedupe([...existing, ...netNew]);
  shuffleInPlace(merged);

  const counts = augmented.reduce<Record<string, number>>((acc, s) => {
    acc[s.label] = (acc[s.label] ?? 0) + 1;
    return acc;
  }, {});
  const netNewCounts = netNew.reduce<Record<string, number>>((acc, s) => {
    acc[s.label] = (acc[s.label] ?? 0) + 1;
    return acc;
  }, {});
  const totalExisting = existing.length;
  const totalMerged = merged.length;

  console.log(
    JSON.stringify(
      {
        mode: append ? "append" : "balanced",
        jobsScanned: rows.length,
        orderBy: append ? "createdAt desc" : "updatedAt desc",
        augmentGeneratedRaw: raw.length,
        augmentAfterDedupe: rawDeduped.length,
        augmentAfterBalance: append ? null : augmented.length,
        netNewRowsAdded: netNew.length,
        augmentPerLabel: counts,
        netNewPerLabel: netNewCounts,
        existingSamples: totalExisting,
        mergedTotal: totalMerged,
        dryRun,
      },
      null,
      2,
    ),
  );

  if (!dryRun) {
    await writeFile(OUTPUT, JSON.stringify(merged, null, 2), "utf8");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
