export type MetricsSourceBucket = "serp" | "job" | "enrichment";

/** Map DB `source` to dashboard bucket (unknown → enrichment). */
export function normalizeEndpointMetricsSource(raw: string): MetricsSourceBucket {
  if (raw === "serp" || raw === "job") return raw;
  return "enrichment";
}
