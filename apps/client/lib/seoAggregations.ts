import {
  fetchSeoAggregations,
  type SeoAggregationsResponse,
} from "./api";

export type SeoAggregationsData = SeoAggregationsResponse["data"];

const EMPTY_AGGREGATIONS: SeoAggregationsData = {
  topSkills: [],
  topCompanies: [],
  salary: { avg: null, min: null, max: null },
  hiringTrend: [],
};

function aggregationFetchTimeoutMs(): number {
  const raw = process.env.SEO_AGGREGATION_FETCH_TIMEOUT_MS?.trim();
  if (!raw) return 1200;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 1200;
  return Math.max(800, Math.min(parsed, 5000));
}

export function isSeoAggregationEnrichmentEnabled(): boolean {
  return process.env.SEO_ENRICHMENT_AGGREGATIONS === "1";
}

export function hasAggregationSidebarContent(data: SeoAggregationsData): boolean {
  if (data.topSkills.length > 0) return true;
  if (data.topCompanies.length > 0) return true;
  if (data.hiringTrend.some((d) => d.count > 0)) return true;
  const { min, max, avg } = data.salary;
  return (
    (typeof min === "number" && min > 0) ||
    (typeof max === "number" && max > 0) ||
    (typeof avg === "number" && avg > 0)
  );
}

/** SSR-safe fetch with timeout and empty fallback (never throws). */
export async function safeFetchSeoAggregations(
  filtersSlug: string,
): Promise<SeoAggregationsData> {
  if (!filtersSlug.trim()) return EMPTY_AGGREGATIONS;

  const timeoutMs = aggregationFetchTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const data = await fetchSeoAggregations({
      filtersSlug,
      signal: controller.signal,
    });
    return data;
  } catch {
    return EMPTY_AGGREGATIONS;
  } finally {
    clearTimeout(timer);
  }
}
