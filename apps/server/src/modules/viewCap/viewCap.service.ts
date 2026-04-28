import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { resolveProPlan } from "../../utils/userPlan.js";
import { LIMITS } from "../../config/limits.js";

/** Seconds from `from` until next UTC midnight. */
export function secondsUntilUtcMidnight(from = new Date()): number {
  const next = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1, 0, 0, 0, 0),
  );
  return Math.max(1, Math.ceil((next.getTime() - from.getTime()) / 1000));
}

export function nextUtcMidnight(from = new Date()): Date {
  return new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1, 0, 0, 0, 0),
  );
}

export function startOfUtcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function hashIp(ip: string): string {
  return createHash("sha256").update(ip.trim()).digest("hex").slice(0, 64);
}

function anonRedisKey(ip: string): string {
  return `viewcap:anon:${hashIp(ip)}`;
}

async function isProUser(
  prisma: PrismaClient,
  userId: string,
  emailHint?: string | null,
): Promise<{ pro: boolean; plan: string }> {
  const resolved = await resolveProPlan(prisma, userId, emailHint);
  return { pro: resolved.pro, plan: resolved.plan };
}

/** Reset DB counter when `jobViewsResetAt` is before today's UTC midnight. */
export async function ensureUserJobViewsDayReset(
  prisma: PrismaClient,
  userId: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { jobViewsResetAt: true },
  });
  if (!user) return;
  const dayStart = startOfUtcDay();
  if (user.jobViewsResetAt < dayStart) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        jobViewsToday: 0,
        jobViewsResetAt: new Date(),
        discoverySearchesToday: 0,
        discoveryBonusFiveUsed: false,
      },
    });
  }
}

/**
 * Remaining job rows the caller may return for this UTC day (before consuming).
 */
export async function getJobViewCapState(
  prisma: PrismaClient,
  redis: Redis,
  opts: { internalUserId?: string | null; ip?: string | null; userEmail?: string | null },
): Promise<{ unlimited: boolean; remaining: number; resetAt: Date }> {
  const resetAt = nextUtcMidnight();

  if (opts.internalUserId) {
    await ensureUserJobViewsDayReset(prisma, opts.internalUserId);
    const { pro } = await isProUser(prisma, opts.internalUserId, opts.userEmail);
    if (pro) {
      return { unlimited: true, remaining: Number.MAX_SAFE_INTEGER, resetAt };
    }
    const user = await prisma.user.findUnique({
      where: { id: opts.internalUserId },
      select: { jobViewsToday: true },
    });
    const used = user?.jobViewsToday ?? 0;
    const remaining = Math.max(0, LIMITS.FREE_TIER_DAILY_LIMIT - used);
    return { unlimited: false, remaining, resetAt };
  }

  const ip = (opts.ip ?? "unknown").trim() || "unknown";
  const key = anonRedisKey(ip);
  const raw = await redis.get(key);
  const used = raw ? Number.parseInt(raw, 10) || 0 : 0;
  const remaining = Math.max(0, LIMITS.FREE_TIER_DAILY_LIMIT - used);
  return { unlimited: false, remaining, resetAt };
}

/**
 * Increment consumed job views after returning `delta` rows from GET /jobs.
 * Pair with `getJobViewCapState` (call state first to clamp limit).
 */
export async function checkAndIncrementViewCap(
  prisma: PrismaClient,
  redis: Redis,
  opts: { internalUserId?: string | null; ip?: string | null; userEmail?: string | null },
  delta: number,
): Promise<{ allowed: boolean; remaining: number; resetAt: Date; unlimited?: boolean }> {
  const resetAt = nextUtcMidnight();
  const safeDelta = Math.min(Math.max(0, Math.floor(delta)), 500);
  if (safeDelta <= 0) {
    const s = await getJobViewCapState(prisma, redis, opts);
    return {
      allowed: s.unlimited || s.remaining > 0,
      remaining: s.unlimited ? LIMITS.FREE_TIER_DAILY_LIMIT : s.remaining,
      resetAt: s.resetAt,
      unlimited: s.unlimited,
    };
  }

  if (opts.internalUserId) {
    await ensureUserJobViewsDayReset(prisma, opts.internalUserId);
    const { pro } = await isProUser(prisma, opts.internalUserId, opts.userEmail);
    if (pro) {
      return { allowed: true, remaining: LIMITS.FREE_TIER_DAILY_LIMIT, resetAt, unlimited: true };
    }
    const rows = await prisma.$queryRaw<[{ jobViewsToday: number }]>`
      UPDATE "User"
      SET "jobViewsToday" = LEAST("jobViewsToday" + ${safeDelta}, ${LIMITS.FREE_TIER_DAILY_LIMIT})
      WHERE "id" = ${opts.internalUserId}
      RETURNING "jobViewsToday"
    `;
    const next = rows[0]?.jobViewsToday ?? 0;
    const remaining = Math.max(0, LIMITS.FREE_TIER_DAILY_LIMIT - next);
    return { allowed: true, remaining, resetAt, unlimited: false };
  }

  const ip = (opts.ip ?? "unknown").trim() || "unknown";
  const key = anonRedisKey(ip);
  const ttl = secondsUntilUtcMidnight();
  const remaining = await incrementAnonViewCapLua(
    redis,
    key,
    safeDelta,
    LIMITS.FREE_TIER_DAILY_LIMIT,
    ttl,
  );
  return { allowed: true, remaining, resetAt, unlimited: false };
}

const VIEWCAP_ANON_LUA = `
local after = redis.call('INCRBY', KEYS[1], ARGV[1])
local capn = tonumber(ARGV[2])
if after > capn then
  redis.call('SET', KEYS[1], capn)
  after = capn
end
local t = redis.call('TTL', KEYS[1])
if t < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[3])
end
return capn - after
`.trim();

let viewCapAnonLuaSha: string | null = null;

/** Atomically add delta to anon counter, clamp to cap, ensure TTL. Returns remaining after increment. */
async function incrementAnonViewCapLua(
  redis: Redis,
  key: string,
  delta: number,
  cap: number,
  ttlSeconds: number,
): Promise<number> {
  const args = [key, String(delta), String(cap), String(ttlSeconds)] as const;
  const runEvalsha = async (sha: string) =>
    redis.evalsha(sha, 1, ...args);

  if (!viewCapAnonLuaSha) {
    viewCapAnonLuaSha = (await redis.script("LOAD", VIEWCAP_ANON_LUA)) as string;
  }
  try {
    const rem = await runEvalsha(viewCapAnonLuaSha);
    return typeof rem === "number" ? rem : Number.parseInt(String(rem), 10) || 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("NOSCRIPT") || msg.includes("No matching script")) {
      viewCapAnonLuaSha = (await redis.script("LOAD", VIEWCAP_ANON_LUA)) as string;
      const rem = await runEvalsha(viewCapAnonLuaSha);
      return typeof rem === "number" ? rem : Number.parseInt(String(rem), 10) || 0;
    }
    throw e;
  }
}
