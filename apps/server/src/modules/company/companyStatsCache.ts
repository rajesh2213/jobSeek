import type { Redis } from "ioredis";
import { isDbPoolExhaustedError } from "../../infrastructure/db/isDbPoolExhausted.js";
import type { CompanyRepository } from "./company.repository.js";

/** Legacy cache key — read-only fallback during rollout; no longer written. */
const STATS_KEY_V1 = "companies:stats:v1";
const STATS_KEY_V2 = "companies:stats:v2";
const STATS_TTL_SEC = Math.max(
  60,
  Number(process.env.COMPANY_STATS_CACHE_TTL_SECONDS ?? "300") || 300,
);

export type CompanyListingStats = {
  totalTracked: number;
  /** @deprecated Use activeHiringCompanies — crawl-touch metric, kept for API compat. */
  hiringThisWeek: number;
  activeHiringCompanies: number;
};

const EMPTY_STATS: CompanyListingStats = {
  totalTracked: 0,
  hiringThisWeek: 0,
  activeHiringCompanies: 0,
};

function parseStatsV2(raw: string): CompanyListingStats | null {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (typeof o.totalTracked !== "number") return null;
    if (typeof o.activeHiringCompanies !== "number") return null;
    return {
      totalTracked: o.totalTracked,
      hiringThisWeek: typeof o.hiringThisWeek === "number" ? o.hiringThisWeek : 0,
      activeHiringCompanies: o.activeHiringCompanies,
    };
  } catch {
    return null;
  }
}

export async function getCompanyListingStatsCached(
  redis: Redis,
  repo: CompanyRepository,
): Promise<CompanyListingStats> {
  const hitV2 = await redis.get(STATS_KEY_V2);
  if (hitV2) {
    const parsed = parseStatsV2(hitV2);
    if (parsed) return parsed;
  }

  try {
    const stats = await repo.getCompaniesListingStats();
    await redis.set(STATS_KEY_V2, JSON.stringify(stats), "EX", STATS_TTL_SEC);
    return stats;
  } catch (err) {
    if (hitV2) {
      const parsed = parseStatsV2(hitV2);
      if (parsed) return parsed;
    }
    const hitV1 = await redis.get(STATS_KEY_V1);
    if (hitV1 && isDbPoolExhaustedError(err)) {
      try {
        const o = JSON.parse(hitV1) as Record<string, unknown>;
        if (typeof o.totalTracked === "number") {
          return {
            totalTracked: o.totalTracked,
            hiringThisWeek: typeof o.hiringThisWeek === "number" ? o.hiringThisWeek : 0,
            activeHiringCompanies: 0,
          };
        }
      } catch {
        /* fall through */
      }
    }
    if (isDbPoolExhaustedError(err)) {
      return EMPTY_STATS;
    }
    throw err;
  }
}
