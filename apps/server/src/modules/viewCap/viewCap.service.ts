import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { resolveProPlan } from "../../utils/userPlan.js";

export const FREE_DAILY_JOB_VIEWS = 10;

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
      data: { jobViewsToday: 0, jobViewsResetAt: new Date() },
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
    const remaining = Math.max(0, FREE_DAILY_JOB_VIEWS - used);
    return { unlimited: false, remaining, resetAt };
  }

  const ip = (opts.ip ?? "unknown").trim() || "unknown";
  const key = anonRedisKey(ip);
  const raw = await redis.get(key);
  const used = raw ? Number.parseInt(raw, 10) || 0 : 0;
  const remaining = Math.max(0, FREE_DAILY_JOB_VIEWS - used);
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
  if (delta <= 0) {
    const s = await getJobViewCapState(prisma, redis, opts);
    return {
      allowed: s.unlimited || s.remaining > 0,
      remaining: s.unlimited ? FREE_DAILY_JOB_VIEWS : s.remaining,
      resetAt: s.resetAt,
      unlimited: s.unlimited,
    };
  }

  if (opts.internalUserId) {
    await ensureUserJobViewsDayReset(prisma, opts.internalUserId);
    const { pro } = await isProUser(prisma, opts.internalUserId, opts.userEmail);
    if (pro) {
      return { allowed: true, remaining: FREE_DAILY_JOB_VIEWS, resetAt, unlimited: true };
    }
    const user = await prisma.user.findUnique({
      where: { id: opts.internalUserId },
      select: { jobViewsToday: true },
    });
    const before = user?.jobViewsToday ?? 0;
    const next = Math.min(FREE_DAILY_JOB_VIEWS, before + delta);
    await prisma.user.update({
      where: { id: opts.internalUserId },
      data: { jobViewsToday: next },
    });
    const remaining = Math.max(0, FREE_DAILY_JOB_VIEWS - next);
    return { allowed: true, remaining, resetAt, unlimited: false };
  }

  const ip = (opts.ip ?? "unknown").trim() || "unknown";
  const key = anonRedisKey(ip);
  const ttl = secondsUntilUtcMidnight();
  const after = await redis.incrby(key, delta);
  const curTtl = await redis.ttl(key);
  if (curTtl < 0) {
    await redis.expire(key, ttl);
  }
  const remaining = Math.max(0, FREE_DAILY_JOB_VIEWS - after);
  return { allowed: true, remaining, resetAt, unlimited: false };
}
