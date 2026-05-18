"use client";

import { useEffect, useState } from "react";
import type { SeoAggregationsData } from "../../lib/seoAggregations";
import { hasAggregationSidebarContent } from "../../lib/seoAggregations";
import { SeoAggregationSidebar } from "./SeoAggregationSidebar";

function SidebarSkeleton() {
  return (
    <aside
      className="animate-pulse space-y-4 rounded-xl border border-ink/10 bg-surface p-4"
      aria-hidden
    >
      <div className="h-3 w-28 rounded bg-ink/10" />
      <div className="h-8 rounded bg-ink/5" />
      <div className="space-y-2">
        <div className="h-3 w-20 rounded bg-ink/10" />
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-6 w-16 rounded-full bg-ink/5" />
          ))}
        </div>
      </div>
    </aside>
  );
}

export function SeoAggregationSidebarHydrator({
  filtersSlug,
  initial,
}: {
  filtersSlug: string;
  initial: SeoAggregationsData | null;
}) {
  const initialReady = Boolean(initial && hasAggregationSidebarContent(initial));
  const [data, setData] = useState<SeoAggregationsData | null>(
    initialReady ? initial : null,
  );
  const [loading, setLoading] = useState(!initialReady);

  useEffect(() => {
    if (initialReady || !filtersSlug.trim()) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

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
      .catch(() => {
        /* graceful: leave sidebar empty */
      })
      .finally(() => {
        setLoading(false);
        clearTimeout(timer);
      });

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [filtersSlug, initialReady]);

  if (data && hasAggregationSidebarContent(data)) {
    return <SeoAggregationSidebar data={data} />;
  }
  if (loading) {
    return <SidebarSkeleton />;
  }
  return null;
}
