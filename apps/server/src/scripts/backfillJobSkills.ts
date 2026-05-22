/**
 * Phase 2: recompute `Job.skills` for active canonical rows using `deriveJobSkills`.
 *
 * Usage:
 *   npx tsx src/scripts/backfillJobSkills.ts                    # dry-run summary
 *   npx tsx src/scripts/backfillJobSkills.ts --apply            # write DB
 *   npx tsx src/scripts/backfillJobSkills.ts --apply --limit 500  # capped
 *   npx tsx src/scripts/backfillJobSkills.ts --only-golang        # rows with golang tag only
 */
import { Prisma } from "@prisma/client";
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { enrichJob } from "../modules/enrichment/enrichment.service.js";
import { deriveJobSkills } from "../utils/jobSkills.js";
function parseArgs(argv: string[]): {
  apply: boolean;
  limit: number | null;
  onlyGolang: boolean;
  batchSize: number;
} {
  let limit: number | null = null;
  let batchSize = 400;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--apply") continue;
    if (arg === "--only-golang") continue;
    if (arg === "--limit" || arg.startsWith("--limit=")) {
      const raw = arg.startsWith("--limit=") ? arg.slice("--limit=".length) : argv[++i];
      const n = parseInt(String(raw ?? ""), 10);
      if (Number.isFinite(n) && n > 0) limit = n;
    } else if (arg === "--batch" || arg.startsWith("--batch=")) {
      const raw = arg.startsWith("--batch=") ? arg.slice("--batch=".length) : argv[++i];
      const n = parseInt(String(raw ?? ""), 10);
      if (Number.isFinite(n) && n > 0) batchSize = Math.min(n, 2000);
    }
  }
  return {
    apply: argv.includes("--apply"),
    limit,
    onlyGolang: argv.includes("--only-golang"),
    batchSize,
  };
}

function skillsKey(skills: string[]): string {
  return [...skills].map((s) => s.trim().toLowerCase()).sort().join("\0");
}

function enrichmentTechStack(parsedDescription: Prisma.JsonValue | null): string[] {
  if (!parsedDescription) return [];
  const enr = enrichJob(parsedDescription) as { techStack?: unknown };
  const tech = enr.techStack;
  return Array.isArray(tech) ? tech.filter((x): x is string => typeof x === "string") : [];
}

async function main(): Promise<void> {
  const { apply, limit, onlyGolang, batchSize } = parseArgs(process.argv.slice(2));
  loadRootEnv();

  const where: Prisma.JobWhereInput = {
    canonicalJobId: null,
    isActive: true,
    ...(onlyGolang
      ? {
          skills: { hasSome: ["golang"] },
        }
      : {}),
  };

  const total = await prisma.job.count({ where });
  const cap = limit !== null ? Math.min(limit, total) : total;

  let scanned = 0;
  let wouldChange = 0;
  let golangRemoved = 0;
  let updated = 0;
  let cursor: string | undefined;

  const startedAt = Date.now();
  console.log(
    JSON.stringify({
      event: "backfill_job_skills_start",
      apply,
      onlyGolang,
      totalMatching: total,
      planned: cap,
      batchSize,
    }),
  );

  while (scanned < cap) {
    const take = Math.min(batchSize, cap - scanned);
    const rows = await prisma.job.findMany({
      where,
      select: {
        id: true,
        title: true,
        description: true,
        isRemote: true,
        locationCity: true,
        category: true,
        skills: true,
        parsedDescription: true,
      },
      orderBy: { id: "asc" },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) break;

    const updates: Array<{ id: string; skills: string[] }> = [];

    for (const row of rows) {
      scanned += 1;
      const techStack = enrichmentTechStack(row.parsedDescription);
      const next = deriveJobSkills({
        title: row.title,
        description: row.description ?? undefined,
        location: row.locationCity ?? undefined,
        isRemote: row.isRemote,
        category: row.category,
        enrichmentTechStack: techStack,
      });
      const cur = row.skills ?? [];
      if (skillsKey(cur) === skillsKey(next)) continue;

      wouldChange += 1;
      const hadGolang = cur.map((s) => s.toLowerCase()).includes("golang");
      const hasGolang = next.includes("golang");
      if (hadGolang && !hasGolang) golangRemoved += 1;

      if (apply) {
        updates.push({ id: row.id, skills: next });
      }
    }

    if (apply && updates.length > 0) {
      await prisma.$transaction(
        updates.map((u) =>
          prisma.job.update({
            where: { id: u.id },
            data: { skills: u.skills },
          }),
        ),
      );
      updated += updates.length;
    }

    cursor = rows[rows.length - 1]!.id;
    if (scanned % 5000 === 0 || scanned >= cap) {
      console.log(
        JSON.stringify({
          event: "backfill_job_skills_progress",
          scanned,
          wouldChange,
          golangRemoved,
          updated,
          elapsedMs: Date.now() - startedAt,
        }),
      );
    }
  }

  const [healthcareGolang, totalGolang] = await Promise.all([
    prisma.job.count({
      where: {
        canonicalJobId: null,
        isActive: true,
        category: "healthcare",
        skills: { hasSome: ["golang"] },
      },
    }),
    prisma.job.count({
      where: {
        canonicalJobId: null,
        isActive: true,
        skills: { hasSome: ["golang"] },
      },
    }),
  ]);

  console.log(
    JSON.stringify(
      {
        event: "backfill_job_skills_done",
        apply,
        scanned,
        wouldChange,
        golangRemoved,
        updated,
        elapsedMs: Date.now() - startedAt,
        postRun: {
          activeCanonicalWithGolang: totalGolang,
          healthcareWithGolang: healthcareGolang,
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
