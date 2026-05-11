import { Prisma } from "@prisma/client";
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { computeCompanyQualityFlags, computeJobQualityFlags } from "../services/qualityFlags.service.js";

type Args = {
  model: "job" | "company" | "both";
  batchSize: number;
  sleepMs: number;
  maxBatches: number;
  dryRun: boolean;
  checkpoint: string | null;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    model: "both",
    batchSize: 200,
    sleepMs: 250,
    maxBatches: 10,
    dryRun: true,
    checkpoint: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--model") {
      const m = String(argv[i + 1] ?? "").toLowerCase();
      if (m === "job" || m === "company" || m === "both") out.model = m;
    }
    if (arg === "--batch-size") out.batchSize = Number(argv[i + 1] ?? out.batchSize);
    if (arg === "--sleep-ms") out.sleepMs = Number(argv[i + 1] ?? out.sleepMs);
    if (arg === "--max-batches") out.maxBatches = Number(argv[i + 1] ?? out.maxBatches);
    if (arg === "--apply") out.dryRun = false;
    if (arg === "--checkpoint") out.checkpoint = String(argv[i + 1] ?? "").trim() || null;
  }
  out.batchSize = Math.max(50, Math.min(2000, Math.floor(out.batchSize)));
  out.sleepMs = Math.max(0, Math.min(10000, Math.floor(out.sleepMs)));
  out.maxBatches = Math.max(1, Math.min(100000, Math.floor(out.maxBatches)));
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkpointGet(key: string): Promise<string | null> {
  const row = await prisma.$queryRaw<Array<{ value: string }>>`
    SELECT "value" FROM "BackfillCheckpoint" WHERE "key" = ${key} LIMIT 1
  `;
  return row[0]?.value ?? null;
}

async function checkpointSet(key: string, value: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "BackfillCheckpoint" ("key", "value", "updatedAt")
    VALUES (${key}, ${value}, NOW())
    ON CONFLICT ("key") DO UPDATE
    SET "value" = EXCLUDED."value", "updatedAt" = NOW()
  `;
}

async function ensureCheckpointTable(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BackfillCheckpoint" (
      "key" TEXT PRIMARY KEY,
      "value" TEXT NOT NULL,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
    )
  `);
}

async function runJobBackfill(args: Args): Promise<{ scanned: number; changed: number; batches: number }> {
  let cursor = args.checkpoint ?? (await checkpointGet("job_quality_flags:last_id")) ?? "";
  let scanned = 0;
  let changed = 0;
  let batches = 0;
  while (batches < args.maxBatches) {
    const rows = await prisma.job.findMany({
      where: {
        id: cursor ? { gt: cursor } : undefined,
      },
      orderBy: { id: "asc" },
      take: args.batchSize,
      select: {
        id: true,
        source: true,
        sourceUrl: true,
        description: true,
        parsedDescription: true,
        hasNonemptyDescription: true,
        hasUsableParsed: true,
        hasValidWorkdayUrlShape: true,
        isPublishable: true,
        requiresRepair: true,
      },
    });
    if (rows.length === 0) break;
    batches += 1;
    scanned += rows.length;
    for (const row of rows) {
      const flags = computeJobQualityFlags({
        source: row.source,
        sourceUrl: row.sourceUrl,
        description: row.description,
        parsedDescription: row.parsedDescription,
      });
      const hasDelta =
        row.hasNonemptyDescription !== flags.hasNonemptyDescription ||
        row.hasUsableParsed !== flags.hasUsableParsed ||
        row.hasValidWorkdayUrlShape !== flags.hasValidWorkdayUrlShape ||
        row.isPublishable !== flags.isPublishable ||
        row.requiresRepair !== flags.requiresRepair;
      if (hasDelta) {
        changed += 1;
        if (!args.dryRun) {
          await prisma.job.update({
            where: { id: row.id },
            data: {
              hasNonemptyDescription: flags.hasNonemptyDescription,
              hasUsableParsed: flags.hasUsableParsed,
              hasValidWorkdayUrlShape: flags.hasValidWorkdayUrlShape,
              isPublishable: flags.isPublishable,
              requiresRepair: flags.requiresRepair,
            } satisfies Prisma.JobUpdateInput,
          });
        }
      }
      cursor = row.id;
    }
    if (!args.dryRun && cursor) await checkpointSet("job_quality_flags:last_id", cursor);
    if (args.sleepMs > 0) await sleep(args.sleepMs);
  }
  return { scanned, changed, batches };
}

async function runCompanyBackfill(args: Args): Promise<{ scanned: number; changed: number; batches: number }> {
  let cursor = args.checkpoint ?? (await checkpointGet("company_quality_flags:last_id")) ?? "";
  let scanned = 0;
  let changed = 0;
  let batches = 0;
  while (batches < args.maxBatches) {
    const rows = await prisma.company.findMany({
      where: {
        id: cursor ? { gt: cursor } : undefined,
      },
      orderBy: { id: "asc" },
      take: args.batchSize,
      select: {
        id: true,
        name: true,
        domain: true,
        atsType: true,
        atsBoardToken: true,
        isPlaceholderCompany: true,
        isCompanyVerified: true,
        requiresCompanyRepair: true,
      },
    });
    if (rows.length === 0) break;
    batches += 1;
    scanned += rows.length;
    for (const row of rows) {
      const flags = computeCompanyQualityFlags({
        name: row.name,
        domain: row.domain,
        atsType: row.atsType,
        atsBoardToken: row.atsBoardToken,
      });
      const hasDelta =
        row.isPlaceholderCompany !== flags.isPlaceholderCompany ||
        row.isCompanyVerified !== flags.isCompanyVerified ||
        row.requiresCompanyRepair !== flags.requiresCompanyRepair;
      if (hasDelta) {
        changed += 1;
        if (!args.dryRun) {
          await prisma.company.update({
            where: { id: row.id },
            data: {
              isPlaceholderCompany: flags.isPlaceholderCompany,
              isCompanyVerified: flags.isCompanyVerified,
              requiresCompanyRepair: flags.requiresCompanyRepair,
            } satisfies Prisma.CompanyUpdateInput,
          });
        }
      }
      cursor = row.id;
    }
    if (!args.dryRun && cursor) await checkpointSet("company_quality_flags:last_id", cursor);
    if (args.sleepMs > 0) await sleep(args.sleepMs);
  }
  return { scanned, changed, batches };
}

async function main(): Promise<void> {
  loadRootEnv();
  const args = parseArgs(process.argv.slice(2));
  await ensureCheckpointTable();

  const out: Record<string, unknown> = {
    dryRun: args.dryRun,
    model: args.model,
    batchSize: args.batchSize,
    sleepMs: args.sleepMs,
    maxBatches: args.maxBatches,
  };
  if (args.model === "job" || args.model === "both") {
    out.jobs = await runJobBackfill(args);
  }
  if (args.model === "company" || args.model === "both") {
    out.companies = await runCompanyBackfill(args);
  }

  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
