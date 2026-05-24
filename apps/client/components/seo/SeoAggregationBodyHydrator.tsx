"use client";

import { useEffect, useState } from "react";
import type { SeoAggregationsData } from "../../lib/seoAggregations";
import { hasAggregationSidebarContent } from "../../lib/seoAggregations";
import { SeoAggregationBodyEnrichment } from "./SeoAggregationBodyEnrichment";

/** Client-side body enrichment when SSR aggregation timed out (reuses sidebar fetch budget). */
export function SeoAggregationBodyHydrator({
  filtersSlug,
  initial,
  ssrAttempted = false,
}: {
  filtersSlug: string;
  initial: SeoAggregationsData | null;
  ssrAttempted?: boolean;
}) {
  const initialReady = Boolean(initial && hasAggregationSidebarContent(initial));
  const [data, setData] = useState<SeoAggregationsData | null>(
    initialReady ? initial : null,
  );

  useEffect(() => {
    if (initialReady || !filtersSlug.trim()) return;

    const controller = new AbortController();
    const clientTimeoutMs = ssrAttempted ? 8000 : 15000;
    const timer = setTimeout(() => controller.abort(), clientTimeoutMs);

    void fetch(`/api/seo/aggregations?filters=${encodeURIComponent(filtersSlug)}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { data?: SeoAggregationsData } | null) => {
        const next = json?.data;
        if (next && hasAggregationSidebarContent(next)) {
          setData(next);
        }
      })
      .catch(() => {})
      .finally(() => clearTimeout(timer));

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [filtersSlug, initialReady, ssrAttempted]);

  if (!data || !hasAggregationSidebarContent(data)) return null;
  return <SeoAggregationBodyEnrichment data={data} />;
}
