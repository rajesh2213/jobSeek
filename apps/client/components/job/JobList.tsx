"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import type { JobItem } from "../../lib/api";
import { JobCard } from "./JobCard";

interface Props {
  jobs: JobItem[];
  flashAppliedJobId?: string | null;
}

function VirtualizedJobList({ jobs, flashAppliedJobId }: Props) {
  const listRef = useRef<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => {
      setScrollMargin(el.offsetTop);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const rowVirtualizer = useWindowVirtualizer({
    count: jobs.length,
    estimateSize: () => 420,
    overscan: 8,
    scrollMargin,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalHeight = rowVirtualizer.getTotalSize();
  const rowWidthClass = useMemo(() => "absolute left-0 top-0 w-full", []);

  return (
    <section ref={listRef} className="relative" style={{ height: `${totalHeight}px` }} aria-label="Job results">
      {virtualRows.map((virtualRow) => {
        const job = jobs[virtualRow.index];
        if (!job) return null;
        return (
          <div
            key={job.id}
            ref={rowVirtualizer.measureElement}
            data-index={virtualRow.index}
            className={rowWidthClass}
            style={{
              transform: `translateY(${virtualRow.start - scrollMargin}px)`,
              paddingBottom: virtualRow.index === jobs.length - 1 ? 0 : "1.25rem",
            }}
          >
            <JobCard job={job} flashAppliedJobId={flashAppliedJobId} />
          </div>
        );
      })}
    </section>
  );
}

export function JobList({ jobs, flashAppliedJobId }: Props) {
  if (jobs.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line bg-white px-6 py-12 text-center text-sm text-ink-muted">
        No jobs found for the selected filters.
      </p>
    );
  }

  return <VirtualizedJobList jobs={jobs} flashAppliedJobId={flashAppliedJobId} />;
}
