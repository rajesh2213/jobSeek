import type { Redis } from "ioredis";

const TTL_SEC = Math.max(
  60,
  Number(process.env.JOB_DETAIL_CACHE_TTL_SECONDS ?? "180") || 180,
);

function detailKey(jobId: string): string {
  return `job:detail:v1:${jobId}`;
}

export async function getCachedJobDetailJson<T>(
  redis: Redis,
  jobId: string,
): Promise<T | null> {
  const raw = await redis.get(detailKey(jobId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setCachedJobDetailJson(
  redis: Redis,
  jobId: string,
  body: unknown,
): Promise<void> {
  await redis.set(detailKey(jobId), JSON.stringify(body), "EX", TTL_SEC);
}
