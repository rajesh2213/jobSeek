import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { createHash } from "node:crypto";
import {
  ensureUserJobViewsDayReset,
  nextUtcMidnight,
  secondsUntilUtcMidnight,
} from "./viewCap.service.js";

/** Same shape as CapContext from jobListCap (avoid circular import). */
export type DiscoveryCapContext = {
  internalUserId: string | null;
  ip: string;
};

export const FREE_DISCOVERY_SEARCHES = 2;
export const FREE_DISCOVERY_ROWS_PER_SEARCH = 10;
export const FREE_DISCOVERY_BONUS_ROWS = 5;
/** Teaser rows when fully capped (preview mode). */
export const DISCOVERY_PREVIEW_ROWS = 2;

/** When false, skip bonus batch (2 searches then straight to preview). */
export function isDiscoveryBonusFiveEnabled(): boolean {
  return process.env.DISCOVERY_BONUS_FIVE?.trim() !== "false";
}

function hashIp(ip: string): string {
  return createHash("sha256").update(ip.trim()).digest("hex").slice(0, 64);
}

function anonDiscoverySearchesKey(ip: string): string {
  return `viewcap:anon:disc:s:${hashIp(ip)}`;
}

function anonDiscoveryBonusKey(ip: string): string {
  return `viewcap:anon:disc:b:${hashIp(ip)}`;
}

export interface DiscoveryListState {
  searchesUsed: number;
  bonusUsed: boolean;
  resetAt: Date;
}

export async function getDiscoveryListState(
  prisma: PrismaClient,
  redis: Redis,
  capCtx: DiscoveryCapContext,
): Promise<DiscoveryListState> {
  const resetAt = nextUtcMidnight();
  if (capCtx.internalUserId) {
    await ensureUserJobViewsDayReset(prisma, capCtx.internalUserId);
    const u = await prisma.user.findUnique({
      where: { id: capCtx.internalUserId },
      select: {
        discoverySearchesToday: true,
        discoveryBonusFiveUsed: true,
      },
    });
    return {
      searchesUsed: Math.min(
        FREE_DISCOVERY_SEARCHES,
        u?.discoverySearchesToday ?? 0,
      ),
      bonusUsed: u?.discoveryBonusFiveUsed ?? false,
      resetAt,
    };
  }
  const ip = (capCtx.ip ?? "unknown").trim() || "unknown";
  const ttl = secondsUntilUtcMidnight();
  const sKey = anonDiscoverySearchesKey(ip);
  const bKey = anonDiscoveryBonusKey(ip);
  const [sRaw, bRaw] = await redis.mget(sKey, bKey);
  const searchesUsed = Math.min(
    FREE_DISCOVERY_SEARCHES,
    sRaw ? Number.parseInt(sRaw, 10) || 0 : 0,
  );
  const bonusUsed = bRaw === "1";
  if (ttl > 0) {
    const p = redis.pipeline();
    p.expire(sKey, ttl);
    p.expire(bKey, ttl);
    await p.exec();
  }
  return { searchesUsed, bonusUsed, resetAt };
}

/** Increment discovery search count (max FREE_DISCOVERY_SEARCHES). Call only for page-1 list requests. */
export async function incrementDiscoverySearch(
  prisma: PrismaClient,
  redis: Redis,
  capCtx: DiscoveryCapContext,
): Promise<DiscoveryListState> {
  const resetAt = nextUtcMidnight();
  if (capCtx.internalUserId) {
    await ensureUserJobViewsDayReset(prisma, capCtx.internalUserId);
    await prisma.$executeRaw`
      UPDATE "User"
      SET "discoverySearchesToday" = LEAST("discoverySearchesToday" + 1, ${FREE_DISCOVERY_SEARCHES})
      WHERE "id" = ${capCtx.internalUserId}
    `;
    const u = await prisma.user.findUnique({
      where: { id: capCtx.internalUserId },
      select: {
        discoverySearchesToday: true,
        discoveryBonusFiveUsed: true,
      },
    });
    return {
      searchesUsed: Math.min(
        FREE_DISCOVERY_SEARCHES,
        u?.discoverySearchesToday ?? 0,
      ),
      bonusUsed: u?.discoveryBonusFiveUsed ?? false,
      resetAt,
    };
  }
  const ip = (capCtx.ip ?? "unknown").trim() || "unknown";
  const key = anonDiscoverySearchesKey(ip);
  const ttl = secondsUntilUtcMidnight();
  const next = await redis.incr(key);
  if (next > FREE_DISCOVERY_SEARCHES) {
    await redis.set(key, String(FREE_DISCOVERY_SEARCHES));
  }
  await redis.expire(key, ttl);
  const sRaw = await redis.get(key);
  const searchesUsed = Math.min(
    FREE_DISCOVERY_SEARCHES,
    sRaw ? Number.parseInt(sRaw, 10) || 0 : 0,
  );
  const bRaw = await redis.get(anonDiscoveryBonusKey(ip));
  return {
    searchesUsed,
    bonusUsed: bRaw === "1",
    resetAt,
  };
}

export async function markDiscoveryBonusUsed(
  prisma: PrismaClient,
  redis: Redis,
  capCtx: DiscoveryCapContext,
): Promise<void> {
  if (capCtx.internalUserId) {
    await ensureUserJobViewsDayReset(prisma, capCtx.internalUserId);
    await prisma.user.update({
      where: { id: capCtx.internalUserId },
      data: { discoveryBonusFiveUsed: true },
    });
    return;
  }
  const ip = (capCtx.ip ?? "unknown").trim() || "unknown";
  const key = anonDiscoveryBonusKey(ip);
  const ttl = secondsUntilUtcMidnight();
  await redis.set(key, "1", "EX", ttl);
}
