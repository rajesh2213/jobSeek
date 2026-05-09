import type { Redis } from "ioredis";
import { logger } from "../../../../utils/logger.js";

function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function openClawQuotaRedisKey(date = new Date()): string {
  return `openclaw:quota:${utcDayKey(date)}`;
}

export interface QuotaCheckResult {
  allowed: boolean;
  used: number;
  limit: number;
  redisAvailable: boolean;
}

/**
 * Daily request budget with optional reserve buffer. Fails closed when Redis errors (skip API calls).
 */
export async function tryConsumeOpenClawQuotaSlot(
  redis: Redis | null,
  maxPerDay: number,
  reserve: number,
): Promise<QuotaCheckResult> {
  const limit = Math.max(0, maxPerDay - Math.max(0, reserve));
  if (!redis) {
    return { allowed: false, used: 0, limit, redisAvailable: false };
  }
  const key = openClawQuotaRedisKey();
  try {
    const n = await redis.incr(key);
    if (n === 1) {
      await redis.pexpire(key, 36 * 60 * 60 * 1000);
    }
    if (n > limit) {
      await redis.decr(key);
      return { allowed: false, used: n - 1, limit, redisAvailable: true };
    }
    return { allowed: true, used: n, limit, redisAvailable: true };
  } catch (err) {
    logger.warn(
      { event: "openclaw_quota_redis_failed", provider: "openclaw", err },
      "openclaw_quota_redis_failed",
    );
    return { allowed: false, used: 0, limit, redisAvailable: false };
  }
}

export async function readOpenClawQuotaUsed(redis: Redis | null): Promise<number | null> {
  if (!redis) return null;
  try {
    const raw = await redis.get(openClawQuotaRedisKey());
    const n = Number(raw ?? "0");
    return Number.isFinite(n) ? n : 0;
  } catch {
    return null;
  }
}
