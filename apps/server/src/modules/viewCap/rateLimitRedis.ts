import { createHash } from "node:crypto";
import type { Redis } from "ioredis";

function hashIp(ip: string): string {
  return createHash("sha256").update(ip.trim()).digest("hex").slice(0, 32);
}

/**
 * Soft rate limit for hot read routes (per IP, fixed window).
 * Returns false when the client should receive HTTP 429.
 */
export async function assertJobReadRateLimit(
  redis: Redis,
  ip: string,
  opts?: { maxPerWindow?: number; windowSec?: number },
): Promise<{ ok: boolean }> {
  const max = opts?.maxPerWindow ?? 180;
  const windowSec = opts?.windowSec ?? 60;
  const key = `rl:jobread:${hashIp(ip)}`;
  const n = await redis.incr(key);
  if (n === 1) {
    await redis.expire(key, windowSec);
  }
  if (n > max) {
    return { ok: false };
  }
  return { ok: true };
}
