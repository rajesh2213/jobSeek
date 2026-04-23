import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Redis } from "ioredis";
import { loadRootEnv } from "../src/infrastructure/env/loadEnv.js";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { batchTransactionOptionsLong } from "../src/infrastructure/db/prismaTransactionOptions.js";

function repoRootDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "..", "..", "..");
}

function removeDirIfExists(target: string): { removed: boolean; existsAfter: boolean; error?: string } {
  if (!fs.existsSync(target)) {
    return { removed: false, existsAfter: false };
  }
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (err) {
    return {
      removed: false,
      existsAfter: fs.existsSync(target),
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return { removed: true, existsAfter: fs.existsSync(target) };
}

function ensureDir(target: string): void {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
}

function removeLegacyAndRoleLogFiles(logsDir: string): {
  scanned: number;
  deleted: string[];
  failed: Array<{ name: string; error: string }>;
  remainingMatches: string[];
} {
  if (!fs.existsSync(logsDir)) {
    return { scanned: 0, deleted: [], failed: [], remainingMatches: [] };
  }

  const legacyPid = /^jobseek-\d+\.log$/i;
  const roleDate = /^jobseek-[a-z0-9-]+-\d{8}\.log$/i;
  const rotatedRoleDate = /^\d{8}-\d+-jobseek-[a-z0-9-]+-\d{8}\.log$/i;
  const matches = (name: string): boolean =>
    legacyPid.test(name) || roleDate.test(name) || rotatedRoleDate.test(name);

  const names = fs.readdirSync(logsDir);
  const deleted: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];

  for (const name of names) {
    if (!matches(name)) continue;
    const fp = path.join(logsDir, name);
    try {
      fs.rmSync(fp, { force: true });
      if (!fs.existsSync(fp)) deleted.push(name);
      else {
        failed.push({ name, error: "still exists after delete attempt" });
      }
    } catch (err) {
      failed.push({
        name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const remainingMatches = fs.existsSync(logsDir)
    ? fs.readdirSync(logsDir).filter(matches)
    : [];

  return { scanned: names.length, deleted, failed, remainingMatches };
}

async function flushRedis(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn("[reset:fresh] skipping redis flush (missing REDIS_URL)");
    return;
  }
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  try {
    await redis.flushall();
  } finally {
    redis.disconnect();
  }
}

async function main(): Promise<void> {
  loadRootEnv();

  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_RESET !== "true") {
    throw new Error("Refusing destructive reset in production. Set ALLOW_PROD_RESET=true to override.");
  }

  console.log("[reset:fresh] started");

  // Wipe all pipeline data tables.
  const deleted = await prisma.$transaction(
    async (tx) => {
      return [await tx.job.deleteMany({}), await tx.company.deleteMany({})] as const;
    },
    { ...batchTransactionOptionsLong },
  );

  await flushRedis();
  await prisma.$disconnect();

  // Delete caches after disconnect and without logger writes to avoid immediate recreation.
  const root = repoRootDir();
  const logsDir = path.join(root, "apps", "server", "logs");
  ensureDir(logsDir);
  const logFileSweep = removeLegacyAndRoleLogFiles(logsDir);
  const nextResult = removeDirIfExists(path.join(root, "apps", "client", ".next"));

  console.log("[reset:fresh] complete");
  console.log(
    JSON.stringify(
      {
        event: "fresh_reset_complete",
        deletedJobs: deleted[0].count,
        deletedCompanies: deleted[1].count,
        redisFlushed: true,
        logsDirKept: true,
        logsFileSweep: logFileSweep,
        nextCache: nextResult,
      },
      null,
      2,
    ),
  );

  if (logFileSweep.remainingMatches.length > 0) {
    console.warn(
      "[reset:fresh] some log files remain. Stop running server/workers/schedulers, then rerun reset.",
    );
  }
}

void main()
  .catch((err) => {
    console.error("[reset:fresh] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {
      /* ignore */
    });
  });
