/**
 * Backfill Job.postedAt for canonical rows where it is null.
 *
 *   cd apps/server && npx tsx src/scripts/backfillPostedAt.ts --dry-run
 *   cd apps/server && npx tsx src/scripts/backfillPostedAt.ts
 */
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";

const BATCH_SIZE = 100;
const PROGRESS_EVERY = 500;
const CREATED_AT_PROXY_MAX_AGE_MS = 90 * 86400000;
/** UUID segment date sanity (per spec). */
const YEAR_MIN = 2020;
const YEAR_MAX = 2026;

const UUID_SEGMENT_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseArgs(argv: string[]) {
  return { dryRun: argv.includes("--dry-run") };
}

function extractUuidTimestampFromUrl(sourceUrl: string): Date | null {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const lever = host.includes("lever.co");
  const ashby = host.includes("ashbyhq.com");
  if (!lever && !ashby) return null;

  for (const seg of url.pathname.split("/").filter(Boolean)) {
    if (!UUID_SEGMENT_RE.test(seg)) continue;
    const first = seg.split("-")[0]!;
    const ts = parseInt(first, 16) * 1000;
    if (!Number.isFinite(ts)) continue;
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) continue;
    const y = d.getUTCFullYear();
    if (y < YEAR_MIN || y > YEAR_MAX) continue;
    return d;
  }
  return null;
}

type Resolution =
  | { kind: "uuid"; postedAt: Date }
  | { kind: "createdAtProxy"; postedAt: Date }
  | { kind: "leftNull" };

function resolvePostedAt(sourceUrl: string, createdAt: Date, now: number): Resolution {
  const fromUuid = extractUuidTimestampFromUrl(sourceUrl);
  if (fromUuid) return { kind: "uuid", postedAt: fromUuid };

  if (createdAt.getTime() >= now - CREATED_AT_PROXY_MAX_AGE_MS) {
    return { kind: "createdAtProxy", postedAt: createdAt };
  }

  return { kind: "leftNull" };
}

function groupByPostedAtTime(
  updates: Array<{ id: string; postedAt: Date }>,
): Map<number, string[]> {
  const m = new Map<number, string[]>();
  for (const u of updates) {
    const t = u.postedAt.getTime();
    const list = m.get(t);
    if (list) list.push(u.id);
    else m.set(t, [u.id]);
  }
  return m;
}

async function main(): Promise<void> {
  loadRootEnv();
  const { dryRun } = parseArgs(process.argv.slice(2));
  const now = Date.now();

  let uuidExtracted = 0;
  let createdAtProxy = 0;
  let leftNull = 0;
  let processed = 0;
  /** Cursor so --dry-run still scans all rows without updating. */
  let cursorId: string | null = null;

  type PostedAtBackfillRow = { id: string; sourceUrl: string; createdAt: Date };

  for (;;) {
    const batch: PostedAtBackfillRow[] = await prisma.job.findMany({
      where: {
        canonicalJobId: null,
        postedAt: null,
        ...(cursorId ? { id: { gt: cursorId } } : {}),
      },
      select: { id: true, sourceUrl: true, createdAt: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    });

    if (batch.length === 0) break;
    cursorId = batch[batch.length - 1]!.id;

    const toWrite: Array<{ id: string; postedAt: Date }> = [];

    for (const row of batch) {
      const r = resolvePostedAt(row.sourceUrl, row.createdAt, now);
      if (r.kind === "uuid") {
        uuidExtracted += 1;
        toWrite.push({ id: row.id, postedAt: r.postedAt });
      } else if (r.kind === "createdAtProxy") {
        createdAtProxy += 1;
        toWrite.push({ id: row.id, postedAt: r.postedAt });
      } else {
        leftNull += 1;
      }
    }

    if (!dryRun && toWrite.length > 0) {
      const grouped = groupByPostedAtTime(toWrite);
      await prisma.$transaction(
        [...grouped.entries()].map(([timeMs, ids]) =>
          prisma.job.updateMany({
            where: { id: { in: ids } },
            data: { postedAt: new Date(timeMs) },
          }),
        ),
      );
    }

    processed += batch.length;
    if (processed % PROGRESS_EVERY === 0) {
      console.log(
        `[progress] processed=${processed} uuidExtracted=${uuidExtracted} createdAtProxy=${createdAtProxy} leftNull=${leftNull}`,
      );
    }

  }

  const total = uuidExtracted + createdAtProxy + leftNull;
  const report = {
    uuidExtracted,
    createdAtProxy,
    leftNull,
    total,
    dryRun,
  };
  console.log("\n=== Summary ===");
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
