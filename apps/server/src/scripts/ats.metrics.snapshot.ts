/**
 * Phase 5 ATS pipeline metrics snapshot (Prisma + Redis).
 * Run: npm run metrics:ats -w @jobseek/server
 */
import { Redis } from "ioredis";
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { logger } from "../utils/logger.js";
import { buildAtsMetricsSnapshot } from "../services/atsMetrics.service.js";

async function tryRedis(): Promise<Redis | null> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  try {
    const r = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: true });
    await r.connect();
    return r;
  } catch (err) {
    logger.warn({ event: "ats_metrics_redis_connect_failed", err }, "ats_metrics_redis_connect_failed");
    return null;
  }
}

async function main(): Promise<void> {
  loadRootEnv();
  const redis = await tryRedis();
  try {
    const snapshot = await buildAtsMetricsSnapshot(prisma, redis);
    logger.info({ event: "ats_metrics_snapshot", ...snapshot }, "ats_metrics_snapshot");
    console.log(JSON.stringify(snapshot, null, 2));
  } finally {
    if (redis) await redis.quit().catch(() => {});
    await prisma.$disconnect();
  }
}

void main().catch((err) => {
  logger.error({ event: "ats_metrics_snapshot_failed", err }, "ats_metrics_snapshot_failed");
  process.exitCode = 1;
});
