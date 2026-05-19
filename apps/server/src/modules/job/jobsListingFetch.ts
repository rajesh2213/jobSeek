import type { Redis } from "ioredis";
import type { PaginatedResult } from "../../types/api.js";
import { isListingDegradedDbError } from "../../infrastructure/db/listingDegradedResponse.js";
import type { JobWithCompany } from "./job.repository.js";
import {
  getCachedJobsListingRaw,
  getStaleJobsListingRaw,
  jobsListingRawCacheKey,
  setCachedJobsListingRaw,
} from "./jobsListingCache.js";

export const JOBS_LISTING_CACHE_ENABLED = process.env.JOBS_LISTING_CACHE_ENABLED !== "0";

export function isJobsListingCacheEligible(input: {
  isAnonymous: boolean;
  isSafeToCache: boolean;
  page: number;
}): boolean {
  return (
    JOBS_LISTING_CACHE_ENABLED &&
    input.isAnonymous &&
    input.isSafeToCache &&
    input.page <= 5
  );
}

export async function fetchJobsListingWithCache(
  redis: Redis,
  cacheInput: { page: number; limit: number; sort: string; filtersKey: string },
  fetchDb: () => Promise<PaginatedResult<JobWithCompany>>,
): Promise<PaginatedResult<JobWithCompany>> {
  const key = jobsListingRawCacheKey(cacheInput);
  const fresh = await getCachedJobsListingRaw(redis, key);
  if (fresh?.items?.length) return fresh;

  try {
    const result = await fetchDb();
    if (result.items.length > 0) {
      void setCachedJobsListingRaw(redis, key, result);
    }
    return result;
  } catch (err) {
    if (!isListingDegradedDbError(err)) throw err;
    const stale = await getStaleJobsListingRaw(redis, key);
    if (stale?.items?.length) return stale;
    throw err;
  }
}
