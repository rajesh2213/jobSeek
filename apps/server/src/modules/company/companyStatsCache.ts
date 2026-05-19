import type { Redis } from "ioredis";
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
  const stats = await repo.getCompaniesListingStats();
  await redis.set(STATS_KEY, JSON.stringify(stats), "EX", STATS_TTL_SEC);
  return stats;
}
