"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";

const formatter = new Intl.NumberFormat("en-US");

function useRollingCount(
  target: number | null,
  loading: boolean,
  { min = 120, max = 12000 }: { min?: number; max?: number } = {},
) {
  const [display, setDisplay] = useState(0);
  const frameRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (frameRef.current != null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    if (loading || target == null) {
      intervalRef.current = setInterval(() => {
        const span = max - min;
        setDisplay(min + Math.floor(Math.random() * span));
      }, 55);
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    }

    const to = target;
    const from = Math.max(0, Math.round(to * 0.72));
    const duration = 480;
    const start = performance.now();
    setDisplay(from);

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, [loading, target, min, max]);

  return display;
}

function StatBadge({
  count,
  label,
  loading,
  range,
}: {
  count: number | null;
  label: string;
  loading: boolean;
  range?: { min?: number; max?: number };
}) {
  const display = useRollingCount(count, loading, range);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-ink/10 bg-surface px-3 py-1 text-xs font-medium text-ink/70 shadow-sm",
        loading && "border-ink/15",
      )}
      aria-busy={loading}
    >
      {loading ? (
        <>
          <span className="tabular-nums opacity-80 motion-reduce:hidden">
            {formatter.format(display)}
          </span>
          <span className="hidden motion-reduce:inline">Counting…</span>
        </>
      ) : (
        <span className="tabular-nums">{formatter.format(display)}</span>
      )}
      <span>{label}</span>
    </span>
  );
}

interface Props {
  totalTracked: number | null;
  activeHiring: number | null;
  loading: boolean;
}

export function CompanyStatsBadges({
  totalTracked,
  activeHiring,
  loading,
}: Props) {
  if (!loading && totalTracked == null && activeHiring == null) {
    return null;
  }

  return (
    <div
      className="mt-4 flex flex-wrap gap-2"
      role={loading ? "status" : undefined}
      aria-live={loading ? "polite" : undefined}
      aria-label={loading ? "Counting company statistics" : undefined}
    >
      <StatBadge
        count={totalTracked}
        label="companies tracked"
        loading={loading}
        range={{ min: 800, max: 18000 }}
      />
      <StatBadge
        count={activeHiring}
        label="actively hiring"
        loading={loading}
        range={{ min: 40, max: 3200 }}
      />
    </div>
  );
}
