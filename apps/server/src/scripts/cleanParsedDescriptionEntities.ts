/**
 * Decode HTML entities in stored parsedDescription line buckets (canonical jobs only).
 *
 *   cd apps/server && npx tsx src/scripts/cleanParsedDescriptionEntities.ts --dry-run
 *   cd apps/server && npx tsx src/scripts/cleanParsedDescriptionEntities.ts
 */
import { Prisma } from "@prisma/client";
import he from "he";
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import type { ParsedJobDescriptionAI } from "../modules/ai/ai.types.js";
import { emptyParsedJobDescription } from "../modules/ai/ai.types.js";
import { asyncPool } from "../utils/asyncPool.js";

const BATCH_SIZE = 100;
const CONCURRENCY = 5;

const BUCKETS: (keyof ParsedJobDescriptionAI)[] = [
  "position",
  "responsibility",
  "requirement",
  "experience",
  "benefit",
  "contact",
  "other",
];

function parseArgs(argv: string[]) {
  return { dryRun: argv.includes("--dry-run") };
}

function cleanLine(line: string): string {
  let s = he.decode(line);
  s = s.replace(/\u00a0/g, " ").replace(/&nbsp;/gi, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function asParsed(v: unknown): ParsedJobDescriptionAI | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const base = emptyParsedJobDescription();
  for (const k of BUCKETS) {
    const a = o[k];
    base[k] = Array.isArray(a) ? a.map((x) => (typeof x === "string" ? x : String(x))) : [];
  }
  return base;
}

function cleanParsed(pd: ParsedJobDescriptionAI): ParsedJobDescriptionAI {
  const out = emptyParsedJobDescription();
  for (const k of BUCKETS) {
    out[k] = (pd[k] ?? []).map((line) => cleanLine(line));
  }
  return out;
}

function linesTouched(pd: ParsedJobDescriptionAI): number {
  let n = 0;
  for (const k of BUCKETS) n += (pd[k] ?? []).length;
  return n;
}

function changedLineCount(before: ParsedJobDescriptionAI, after: ParsedJobDescriptionAI): number {
  let n = 0;
  for (const k of BUCKETS) {
    const a = before[k] ?? [];
    const b = after[k] ?? [];
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      if ((a[i] ?? "") !== (b[i] ?? "")) n += 1;
    }
  }
  return n;
}

async function main(): Promise<void> {
  loadRootEnv();
  const { dryRun } = parseArgs(process.argv.slice(2));

  const total = await prisma.job.count({
    where: {
      canonicalJobId: null,
      NOT: { parsedDescription: { equals: Prisma.DbNull } },
    },
  });

  let cleaned = 0;
  let unchanged = 0;
  let failed = 0;
  let totalLines = 0;
  let cursorId: string | null = null;
  let processed = 0;

  for (;;) {
    const batch: { id: string; parsedDescription: unknown }[] = await prisma.job.findMany({
      where: {
        canonicalJobId: null,
        NOT: { parsedDescription: { equals: Prisma.DbNull } },
        ...(cursorId ? { id: { gt: cursorId } } : {}),
      },
      select: { id: true, parsedDescription: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    });

    if (batch.length === 0) break;
    cursorId = batch[batch.length - 1]!.id;

    type Out = {
      kind: "cleaned" | "unchanged" | "failed";
      id: string;
      lineChanges: number;
      linesTouched: number;
    };

    const outs = await asyncPool(batch, CONCURRENCY, async (row): Promise<Out> => {
      try {
        const parsed = asParsed(row.parsedDescription);
        if (!parsed) {
          return { kind: "failed", id: row.id, lineChanges: 0, linesTouched: 0 };
        }
        const lt = linesTouched(parsed);
        const next = cleanParsed(parsed);
        const lineChanges = changedLineCount(parsed, next);
        if (lineChanges === 0) {
          return { kind: "unchanged", id: row.id, lineChanges: 0, linesTouched: lt };
        }
        if (!dryRun) {
          await prisma.job.update({
            where: { id: row.id },
            data: { parsedDescription: next as unknown as Prisma.InputJsonValue },
          });
        }
        return { kind: "cleaned", id: row.id, lineChanges, linesTouched: lt };
      } catch {
        return { kind: "failed", id: row.id, lineChanges: 0, linesTouched: 0 };
      }
    });

    for (const o of outs) {
      processed += 1;
      totalLines += o.linesTouched;
      if (o.kind === "cleaned") cleaned += 1;
      else if (o.kind === "unchanged") unchanged += 1;
      else failed += 1;

      if (processed % 100 === 0 || processed === total) {
        if (o.kind === "cleaned") {
          console.log(`[${processed}/${total}] cleaned ${o.lineChanges} lines in ${o.id}`);
        } else if (o.kind === "unchanged") {
          console.log(`[${processed}/${total}] no change ${o.id}`);
        }
      }
    }

    if (batch.length < BATCH_SIZE) break;
  }

  console.log("\n=== Summary ===");
  console.log(
    JSON.stringify(
      { cleaned, unchanged, failed, totalLines, dryRun },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
