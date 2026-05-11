import type { Redis } from "ioredis";
import { randomUUID } from "node:crypto";

export type RollingQuotaPeek = {
  used: number;
  remaining: number;
  resetAtMs: number;
};

const PEEK_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
local minScore = now - windowMs
redis.call('ZREMRANGEBYSCORE', key, '-inf', minScore)
local n = redis.call('ZCARD', key)
local oldestMs = now
local r = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
if r and r[2] then
  oldestMs = tonumber(r[2])
end
local resetAt = oldestMs + windowMs
local remaining = max - n
if remaining < 0 then remaining = 0 end
return {n, resetAt, remaining}
`;

const RESERVE_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
local member = ARGV[4]
local minScore = now - windowMs
redis.call('ZREMRANGEBYSCORE', key, '-inf', minScore)
local n = redis.call('ZCARD', key)
if n >= max then
  local oldestMs = now
  local r = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  if r and r[2] then
    oldestMs = tonumber(r[2])
  end
  local resetAt = oldestMs + windowMs
  return {0, n, resetAt}
end
redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, math.ceil(windowMs / 1000) + 300)
local n2 = redis.call('ZCARD', key)
local oldest2 = now
local r2 = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
if r2 and r2[2] then
  oldest2 = tonumber(r2[2])
end
local resetAt2 = oldest2 + windowMs
return {1, n2, resetAt2}
`;

/**
 * Rolling window quota using a Redis sorted set (score = event time ms).
 * Efficient for moderate QPS; trim + O(log N) inserts per request.
 */
export async function peekRollingWindowQuota(
  redis: Redis,
  key: string,
  opts: { nowMs: number; windowMs: number; max: number },
): Promise<RollingQuotaPeek> {
  const raw = (await redis.eval(
    PEEK_LUA,
    1,
    key,
    String(opts.nowMs),
    String(opts.windowMs),
    String(opts.max),
  )) as [number, number, number];
  const used = Number(raw[0]) || 0;
  const resetAtMs = Number(raw[1]) || opts.nowMs + opts.windowMs;
  const remaining = Number(raw[2]) ?? Math.max(0, opts.max - used);
  return { used, remaining, resetAtMs };
}

export async function reserveRollingWindowQuota(
  redis: Redis,
  key: string,
  opts: { nowMs: number; windowMs: number; max: number; memberId: string },
): Promise<{ ok: true; used: number; resetAtMs: number } | { ok: false; used: number; resetAtMs: number }> {
  const raw = (await redis.eval(
    RESERVE_LUA,
    1,
    key,
    String(opts.nowMs),
    String(opts.windowMs),
    String(opts.max),
    opts.memberId,
  )) as [number, number, number];
  const ok = Number(raw[0]) === 1;
  const used = Number(raw[1]) || 0;
  const resetAtMs = Number(raw[2]) || opts.nowMs + opts.windowMs;
  return ok ? { ok: true, used, resetAtMs } : { ok: false, used, resetAtMs };
}

export function newQuotaMemberId(): string {
  return randomUUID();
}

export async function releaseRollingWindowQuotaMember(
  redis: Redis,
  key: string,
  memberId: string,
): Promise<void> {
  await redis.zrem(key, memberId);
}
