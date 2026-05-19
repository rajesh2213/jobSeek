import type { Redis } from "ioredis";
import { isDbPoolExhaustedError } from "../../infrastructure/db/isDbPoolExhausted.js";
import type { CompanyRepository } from "./company.repository.js";

const STATS_KEY = "companies:stats:v1";
const STATS_TTL_SEC = Math.max(
  60,
  Number(process.env.COMPANY_STATS_CACHE_TTL_SECONDS ?? "300") || 300,
);

export type CompanyListingStats = {
  totalTracked: number;
  hiringThisWeek: number;
};

export async function getCompanyListingStatsCached(
  redis: Redis,
  repo: CompanyRepository,
): Promise<CompanyListingStats> {
  const hit = await redis.get(STATS_KEY);
  if (hit) {
    try {
      return JSON.parse(hit) as CompanyListingStats;
    } catch {
      /* refresh */
    }
  }
  try {
    const stats = await repo.getCompaniesListingStats();
    await redis.set(STATS_KEY, JSON.stringify(stats), "EX", STATS_TTL_SEC);
    return stats;
  } catch (err) {
    if (hit && isDbPoolExhaustedError(err)) {
      try {
        return JSON.parse(hit) as CompanyListingStats;
      } catch {
        /* fall through */
      }
    }
    if (isDbPoolExhaustedError(err)) {
      return { totalTracked: 0, hiringThisWeek: 0 };
    }
    throw err;
  }
}
