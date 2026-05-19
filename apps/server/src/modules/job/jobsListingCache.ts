import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
import type { PaginatedResult } from "../../types/api.js";
import type { JobWithCompany } from "./job.repository.js";
import {
  readListingFresh,
  readListingStale,
  writeListingCache,
} from "../../infrastructure/cache/listingRedisCache.js";

export function jobsListingRawCacheKey(input: {
  page: number;
  limit: number;
  sort: string;
  filtersKey: string;
}): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        p: input.page,
        l: input.limit,
        s: input.sort,
        f: input.filtersKey,
      }),
    )
    .digest("hex")
    .slice(0, 24);
  return `jobs:raw:v2:${digest}`;
}

export async function getCachedJobsListingRaw(
  redis: Redis,
  key: string,
): Promise<PaginatedResult<JobWithCompany> | null> {
  return readListingFresh(redis, key);
}

export async function getStaleJobsListingRaw(
  redis: Redis,
  key: string,
): Promise<PaginatedResult<JobWithCompany> | null> {
  return readListingStale(redis, key);
}

export async function setCachedJobsListingRaw(
  redis: Redis,
  key: string,
  result: PaginatedResult<JobWithCompany>,
): Promise<void> {
  await writeListingCache(redis, key, result);
}
