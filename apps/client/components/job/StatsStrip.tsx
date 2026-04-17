"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { fadeUp, motionEase, scaleHover } from "../../lib/motion";

function useCountUp(target: number, durationMs: number, active: boolean): number {
  const [value, setValue] = useState(active ? 0 : target);
  useEffect(() => {
    if (!active) {
      setValue(target);
      return;
    }
    let start: number | null = null;
    let frame = 0;
    const ease = (t: number) => 1 - (1 - t) ** 3;
    const step = (now: number) => {
      if (start === null) start = now;
      const p = Math.min(1, (now - start) / durationMs);
      setValue(Math.round(ease(p) * target));
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs, active]);
  return value;
}

export interface StatsStripProps {
  /** Optional listing total to derive a plausible “this week” figure (still illustrative). */
  totalListings?: number;
  className?: string;
  /** Applied to the horizontal row of pills (e.g. `lg:justify-end` in the hero). */
  rowClassName?: string;
  /**
   * `hero-split`: row 1 = `heroFirstRowLeading`; row 2 = `heroStatRowPrefix` + both stat pills (wrap),
   * with `heroSecondRowLeading` beside the cluster on `sm+` (e.g. Stay early →).
   */
  variant?: "default" | "hero-split";
  heroFirstRowLeading?: ReactNode;
  /** Rendered left of the stat pills on the second row (e.g. Smart Apply). */
  heroStatRowPrefix?: ReactNode;
  heroSecondRowLeading?: ReactNode;
}

export function StatsStrip({
  totalListings,
  className,
  rowClassName,
  variant = "default",
  heroFirstRowLeading,
  heroStatRowPrefix,
  heroSecondRowLeading,
}: StatsStripProps) {
  const reduceMotion = useReducedMotion();
  const countActive = !reduceMotion;

  const linkedInPct = useCountUp(73, 1000, countActive);
  const jobsThisWeekTarget = useMemo(() => {
    const t = totalListings ?? 18_000;
    return Math.max(3_200, Math.min(52_000, Math.round(t * 0.62 + 4_800)));
  }, [totalListings]);
  const jobsWeek = useCountUp(jobsThisWeekTarget, 1100, countActive);

  const [shimmerIndex, setShimmerIndex] = useState(0);
  useEffect(() => {
    if (reduceMotion) return;
    const id = window.setInterval(() => {
      setShimmerIndex((i) => (i + 1) % 2);
    }, 3600);
    return () => window.clearInterval(id);
  }, [reduceMotion]);

  const pills = [
    {
      key: "linkedin",
      content: (
        <>
          <span className="font-semibold text-brand tabular-nums">{linkedInPct}</span>
          <span>% of roles are NOT on LinkedIn</span>
        </>
      ),
    },
    {
      key: "week",
      content: (
        <>
          <span className="font-semibold tabular-nums text-ink">{jobsWeek.toLocaleString()}</span>
          <span> jobs posted this week</span>
        </>
      ),
    },
  ];

  const pillClassName = cn(
    "relative isolate overflow-hidden rounded-full border border-ink/10 bg-surface/95 px-3.5 py-2 text-xs font-medium leading-snug text-ink/80 shadow-sm",
    "will-change-transform",
    "hover:shadow-[0_0_22px_rgba(232,83,58,0.12)] hover:ring-1 hover:ring-brand/15",
  );

  const renderPill = (i: number) => {
    const pill = pills[i]!;
    return (
      <motion.div
        key={pill.key}
        variants={fadeUp}
        transition={{ duration: 0.45, ease: motionEase }}
        whileHover={scaleHover.whileHover}
        className={pillClassName}
      >
        <span className="relative z-[1] inline-flex flex-wrap items-baseline gap-x-1 gap-y-0">
          {pill.content}
        </span>
        {shimmerIndex === i ? (
          <span
            className={cn(
              "pointer-events-none absolute inset-0 z-[2] rounded-full mix-blend-soft-light",
              !reduceMotion && "jobseek-stat-shimmer",
            )}
            aria-hidden
          />
        ) : null}
      </motion.div>
    );
  };

  const rowClass = cn("flex flex-wrap items-center gap-2 sm:gap-2.5", rowClassName);

  if (variant === "hero-split") {
    return (
      <motion.div
        className={cn("mb-6 mt-1", className)}
        initial="hidden"
        animate="visible"
        variants={{
          hidden: {},
          visible: {
            transition: { staggerChildren: 0.07, delayChildren: 0.05 },
          },
        }}
      >
        <div className="min-w-0 max-w-xl">{heroFirstRowLeading}</div>
        <div className="mt-3 flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-x-6">
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-2.5">
            {heroStatRowPrefix}
            {renderPill(0)}
            {renderPill(1)}
          </div>
          <div className="min-w-0 shrink-0 sm:pt-0.5">{heroSecondRowLeading}</div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className={cn("mb-6 mt-1", className)}
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: { staggerChildren: 0.07, delayChildren: 0.05 },
        },
      }}
    >
      <div className={rowClass}>{pills.map((_, i) => renderPill(i))}</div>
    </motion.div>
  );
}
