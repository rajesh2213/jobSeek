/**
 * Pre-flight safety checks for ingestion expansion scripts.
 * Import and call `runSafetyChecks()` before any mutation script proceeds.
 *
 * Aborts if:
 *   - ATS queue waiting count > threshold
 *   - Oldest queue wait > threshold
 *   - Prisma pool appears exhausted (slow query response)
 *   - Too many endpoints already created this run window
 */

import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

export interface SafetyConfig {
  maxQueueWaiting?: number;
  maxOldestWaitMs?: number;
  maxDbResponseMs?: number;
  maxEndpointsCreatedPerHour?: number;
  redisUrl?: string;
  queueName?: string;
}

export interface SafetyResult {
  safe: boolean;
  checks: {
    name: string;
    passed: boolean;
    value: number | null;
    threshold: number;
    message: string;
  }[];
}

const DEFAULTS: Required<SafetyConfig> = {
  maxQueueWaiting: 50,
  maxOldestWaitMs: 120_000,
  maxDbResponseMs: 5_000,
  maxEndpointsCreatedPerHour: 100,
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  queueName: "ingest-ats-endpoint",
};

const CREATION_COUNTER_KEY = "safety:endpoint_creations_hour";

export async function runSafetyChecks(
  prisma: PrismaClient,
  config?: SafetyConfig,
): Promise<SafetyResult> {
  const cfg = { ...DEFAULTS, ...config };
  const checks: SafetyResult["checks"] = [];

  // Check 1: Queue depth
  let redis: Redis | null = null;
  try {
    redis = new Redis(cfg.redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
    await redis.connect();
    const queue = new Queue(cfg.queueName, { connection: redis });
    try {
      const counts = await queue.getJobCounts("waiting", "active");
      const waiting = counts.waiting ?? 0;
      checks.push({
        name: "queue_waiting",
        passed: waiting <= cfg.maxQueueWaiting,
        value: waiting,
        threshold: cfg.maxQueueWaiting,
        message: waiting <= cfg.maxQueueWaiting
          ? `Queue waiting OK (${waiting})`
          : `Queue too deep: ${waiting} > ${cfg.maxQueueWaiting}`,
      });

      // Check oldest waiting
      const jobs = await queue.getJobs(["waiting"], 0, 0, true);
      const oldest = jobs[0]?.timestamp ? Date.now() - jobs[0].timestamp : null;
      checks.push({
        name: "oldest_wait_ms",
        passed: oldest == null || oldest <= cfg.maxOldestWaitMs,
        value: oldest,
        threshold: cfg.maxOldestWaitMs,
        message: oldest == null
          ? "No waiting jobs"
          : oldest <= cfg.maxOldestWaitMs
            ? `Oldest wait OK (${Math.round(oldest / 1000)}s)`
            : `Oldest wait too high: ${Math.round(oldest / 1000)}s > ${cfg.maxOldestWaitMs / 1000}s`,
      });
    } finally {
      await queue.close();
    }

    // Check creation counter
    const creations = Number(await redis.get(CREATION_COUNTER_KEY) ?? "0");
    checks.push({
      name: "creations_this_hour",
      passed: creations < cfg.maxEndpointsCreatedPerHour,
      value: creations,
      threshold: cfg.maxEndpointsCreatedPerHour,
      message: creations < cfg.maxEndpointsCreatedPerHour
        ? `Creations this hour OK (${creations})`
        : `Too many creations this hour: ${creations} >= ${cfg.maxEndpointsCreatedPerHour}`,
    });
  } catch (err) {
    checks.push({
      name: "redis_connection",
      passed: false,
      value: null,
      threshold: 0,
      message: `Redis connection failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  } finally {
    if (redis) await redis.quit().catch(() => {});
  }

  // Check 2: DB responsiveness
  const dbStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const dbMs = Date.now() - dbStart;
    checks.push({
      name: "db_response_ms",
      passed: dbMs <= cfg.maxDbResponseMs,
      value: dbMs,
      threshold: cfg.maxDbResponseMs,
      message: dbMs <= cfg.maxDbResponseMs
        ? `DB response OK (${dbMs}ms)`
        : `DB too slow: ${dbMs}ms > ${cfg.maxDbResponseMs}ms`,
    });
  } catch (err) {
    checks.push({
      name: "db_response_ms",
      passed: false,
      value: null,
      threshold: cfg.maxDbResponseMs,
      message: `DB query failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const safe = checks.every((c) => c.passed);
  return { safe, checks };
}

export async function incrementCreationCounter(redisUrl?: string): Promise<void> {
  const url = redisUrl ?? process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
  const redis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
  try {
    await redis.connect();
    const pipe = redis.pipeline();
    pipe.incr(CREATION_COUNTER_KEY);
    pipe.expire(CREATION_COUNTER_KEY, 3600);
    await pipe.exec();
  } finally {
    await redis.quit().catch(() => {});
  }
}

export function printSafetyResult(result: SafetyResult): void {
  console.log(`\n=== Safety Checks: ${result.safe ? "PASS ✓" : "FAIL ✗"} ===`);
  for (const check of result.checks) {
    const icon = check.passed ? "✓" : "✗";
    console.log(`  [${icon}] ${check.name}: ${check.message}`);
  }
  console.log("");
}
