"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useReducedMotion } from "framer-motion";
import { cn } from "../../lib/cn";
import { Container } from "../ui/Container";
import { StatsStrip } from "./StatsStrip";

export interface TimeAdvantageSimulatorProps {
  /** Real weekly posted-job count from API (or env override). */
  jobsPostedThisWeek?: number;
  /** Shown to the left of the LinkedIn / jobs-this-week pills (e.g. Smart Apply). */
  statRowPrefix?: ReactNode;
}

/**
 * Jobs page hero — full-width headline; subline on one row; “Stay early” + both stat pills on the next.
 */
export function TimeAdvantageSimulator({
  jobsPostedThisWeek,
  statRowPrefix,
}: TimeAdvantageSimulatorProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div
      id="section-hero"
      className="relative w-full pt-10 pb-6 lg:pt-12 lg:pb-8"
      aria-labelledby="jobs-hero-heading"
    >
      <div className="pointer-events-none absolute inset-0 overflow-visible" aria-hidden>
        <div
          className={cn(
            "absolute -left-[8%] top-1/2 h-[min(280px,65vw)] w-[min(280px,65vw)] -translate-y-1/2 rounded-full",
            "bg-[radial-gradient(circle_at_center,rgba(244,239,230,0.85)_0%,transparent_70%)]",
            !prefersReducedMotion && "jobseek-hero-gradient-blob",
          )}
        />
      </div>

      <Container width="jobs" className="relative z-[1]">
        <h1
          id="jobs-hero-heading"
          className="w-full max-w-none font-sans text-[clamp(1.45rem,3.2vw,2.1rem)] font-semibold leading-[1.2] tracking-tight text-ink"
        >
          Be early once — or <span className="text-brand">stay early</span> every{'\u00A0'}time.
        </h1>

        <StatsStrip
          variant="hero-split"
          jobsPostedThisWeek={jobsPostedThisWeek}
          className="mb-0 mt-4"
          heroStatRowPrefix={statRowPrefix}
          heroFirstRowLeading={
            <p className="min-w-0 max-w-2xl shrink-0 text-[15px] leading-snug text-ink/55 sm:max-w-none sm:text-base">
              That&apos;s the difference between browsing and getting interviews.
            </p>
          }
          heroSecondRowLeading={
            <Link
              href="/pricing"
              className={cn(
                "inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-brand no-underline",
                "decoration-brand/35 underline-offset-4 transition-[text-shadow,opacity] duration-300",
                "hover:underline hover:decoration-brand/60",
                "hover:[text-shadow:0_0_14px_rgba(0,0,0,0.08)]",
              )}
            >
              Stay early →
            </Link>
          }
        />
      </Container>
    </div>
  );
}
