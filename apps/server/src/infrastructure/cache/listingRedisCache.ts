import type { Redis } from "ioredis";

const STALE_SUFFIX = ":stale";

export const LISTING_FRESH_TTL_SEC = Math.max(
  60,
  Number(process.env.LISTING_CACHE_TTL_SECONDS ?? "120") || 120,
);

export const LISTING_STALE_TTL_SEC = Math.max(
  300,
  Number(process.env.LISTING_STALE_CACHE_TTL_SECONDS ?? "3600") || 3600,
);

export async function readListingFresh<T>(redis: Redis, key: string): Promise<T | null> {
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function readListingStale<T>(redis: Redis, key: string): Promise<T | null> {
  const raw = await redis.get(`${key}${STALE_SUFFIX}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeListingCache(
  redis: Redis,
  key: string,
  body: unknown,
  ttlSec = LISTING_FRESH_TTL_SEC,
): Promise<void> {
  const json = JSON.stringify(body);
  await redis
    .multi()
    .set(key, json, "EX", ttlSec)
    .set(`${key}${STALE_SUFFIX}`, json, "EX", LISTING_STALE_TTL_SEC)
    .exec();
}
