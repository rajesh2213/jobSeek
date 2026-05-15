import { createHash } from "node:crypto";
import type { JobDiscoveryFilters } from "../job/job.repository.js";
import type { SeoAggregations } from "./seoAggregations.service.js";
import { getIoredis } from "../../queues/job.queue.js";

function aggregationCacheEnabled(): boolean {
  return process.env.SEO_AGGREGATION_REDIS_CACHE === "1";
}

function aggregationCacheTtlSeconds(): number {
  const raw = process.env.SEO_AGGREGATION_CACHE_TTL_SECONDS?.trim();
  if (!raw) return 60;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 60;
  return Math.max(15, Math.min(parsed, 300));
}

function filtersCacheKey(filters: JobDiscoveryFilters): string {
  const keys = Object.keys(filters).sort();
  const stable: Record<string, unknown> = {};
  for (const k of keys) {
    stable[k] = filters[k as keyof JobDiscoveryFilters];
  }
  const digest = createHash("sha256")
    .update(JSON.stringify(stable))
    .digest("hex")
    .slice(0, 24);
  return `seo:agg:v1:${digest}`;
}

export async function readCachedAggregations(
  filters: JobDiscoveryFilters,
): Promise<SeoAggregations | null> {
  if (!aggregationCacheEnabled()) return null;
  try {
    const redis = getIoredis();
    const raw = await redis.get(filtersCacheKey(filters));
    if (!raw) return null;
    return JSON.parse(raw) as SeoAggregations;
  } catch {
    return null;
  }
}

export async function writeCachedAggregations(
  filters: JobDiscoveryFilters,
  data: SeoAggregations,
): Promise<void> {
  if (!aggregationCacheEnabled()) return;
  try {
    const redis = getIoredis();
    await redis.set(
      filtersCacheKey(filters),
      JSON.stringify(data),
      "EX",
      aggregationCacheTtlSeconds(),
    );
  } catch {
    // Cache write failure must not affect the response path.
  }
}
