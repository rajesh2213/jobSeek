"use client";

import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SignInButton, useAuth } from "@clerk/nextjs";
import type { JobItem } from "../../lib/api";
import { cn } from "../../lib/cn";
import { motionEase } from "../../lib/motion";
import type { AccentTone } from "../ui/types";
import { Card } from "../ui/Card";
import { ScrollCollapseChrome } from "./ScrollCollapseChrome";

const CORAL = "#E8533A";
const INK = "#1a1a1a";

const ACCENTS: AccentTone[] = ["brand", "teal", "rose", "amber"];

/** Fictional placeholders only—avoid real employer brands in blurred preview cards. */
const FAKE_JOBS = [
  { title: "Backend Engineer", company: "Northwind Labs", location: "Remote · United States" },
  { title: "Product Analyst", company: "Example Health Co.", location: "San Francisco, CA" },
  { title: "Frontend Engineer", company: "Acme SaaS Inc.", location: "Remote · Worldwide" },
  { title: "Data Scientist", company: "Contoso Analytics", location: "Austin, TX" },
  { title: "Product Designer", company: "Sample Fintech Ltd.", location: "Remote · US" },
  { title: "Platform Engineer", company: "Demo Systems LLC", location: "New York, NY" },
] as const;

const POSTED_VARIANTS = ["Posted 2h ago", "Posted 1d ago", "Recently posted"] as const;

const SLOT_COUNT_FULL = 4;
const SLOT_COUNT_PREVIEW = 3;

type BlurJobSlot = {
  id: number;
  title: string;
  company: string;
  location: string;
  accent: AccentTone;
  postedLabel: string;
};

function logoTileClass(accent: AccentTone): string {
  return cn(
    "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-base font-black ring-1 ring-ink/5",
    accent === "teal" && "bg-teal-soft text-teal",
    accent === "rose" && "bg-rose-soft text-rose",
    accent === "amber" && "bg-amber-soft text-amber",
    accent === "brand" && "bg-brand/10 text-brand",
  );
}

/** Same information hierarchy as JobCard / Card, then blurred as a stack. */
function LimitBlurFakeJobCard({ job }: { job: BlurJobSlot }) {
  const initial = job.company.trim().slice(0, 1).toUpperCase();

  return (
    <Card
      as="div"
      accent={job.accent}
      className="pointer-events-none !p-5 !shadow-none ring-1 ring-ink/[0.06] sm:!p-6"
      aria-hidden
    >
      <div className="flex gap-4 sm:gap-5">
        <div className={logoTileClass(job.accent)}>{initial}</div>
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-ink/30">
              {job.postedLabel}
            </span>
          </div>
          <h3 className="line-clamp-2 text-base font-extrabold leading-snug tracking-tight text-ink sm:text-lg">
            {job.title}
          </h3>
          <p className="mt-1 text-sm font-bold text-ink/75">{job.company}</p>
          <p className="mt-2 text-[13px] leading-snug text-black/50">
            📍 {job.location}
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-ink/5 pt-4 opacity-90">
        <div className="h-8 w-[4.5rem] rounded-lg bg-ink/[0.06] ring-1 ring-ink/[0.06]" />
        <div className="h-8 w-[4.5rem] rounded-lg bg-ink/[0.06] ring-1 ring-ink/[0.06]" />
        <div className="h-8 min-w-[5.5rem] flex-1 rounded-lg bg-brand/[0.12] ring-1 ring-brand/20 sm:max-w-[7rem]" />
      </div>
    </Card>
  );
}

function LimitPreviewBlurStack({ slotCount }: { slotCount: number }) {
  const [visibleJobs, setVisibleJobs] = useState<BlurJobSlot[]>(() =>
    Array.from({ length: slotCount }, (_, i) => {
      const j = FAKE_JOBS[i % FAKE_JOBS.length];
      return {
        id: i,
        title: j.title,
        company: j.company,
        location: j.location,
        accent: ACCENTS[i % ACCENTS.length],
        postedLabel: POSTED_VARIANTS[i % POSTED_VARIANTS.length],
      };
    }),
  );

  return (
    <div
      className="pointer-events-none flex select-none flex-col gap-3 opacity-[0.9] [transform:translateZ(0)] [mask-image:linear-gradient(to_bottom,black_0%,black_88%,transparent_100%)]"
      style={{ filter: "blur(3.5px)" }}
    >
      {visibleJobs.map((job) => (
        <div key={job.id}>
          <LimitBlurFakeJobCard job={job} />
        </div>
      ))}
    </div>
  );
}

function formatHm(ms: number): { h: number; m: number } {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return { h, m };
}

function LockIconCoral({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M7 11V8a5 5 0 0 1 10 0v3"
        stroke={CORAL}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x={5}
        y={11}
        width={14}
        height={10}
        rx={2}
        stroke={CORAL}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export type DiscoveryWallPhase = "search" | "preview";

interface Props {
  resetAt: string;
  /** Roles not shown (beyond free slice / preview). */
  count: number;
  previewJobs: JobItem[];
  phase: DiscoveryWallPhase;
  /** When false, preview-phase subcopy collapses (scroll-driven from parent). Default true. */
  scrollRevealSubcopy?: boolean;
}

function countPostedInLast2Hours(jobs: JobItem[]): number {
  const now = Date.now();
  const twoH = 2 * 60 * 60 * 1000;
  return jobs.filter((j) => {
    /**
     * Only count rows with a real employer-supplied publish date. Mixing in
     * crawl timestamps would inflate the "posted in the last 2 hours" claim
     * shown on the upgrade wall and undermine trust.
     */
    const isPosted =
      j.freshness?.source === "POSTED" ||
      (j.freshness == null && j.postedAt != null && j.postedAt !== "null");
    if (!isPosted) return false;
    const iso = j.freshness?.timestamp ?? j.postedAt;
    if (!iso) return false;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return false;
    const age = now - t;
    return age >= 0 && age <= twoH;
  }).length;
}

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

export function LimitWallEnhanced({
  resetAt,
  count,
  previewJobs,
  phase,
  scrollRevealSubcopy = true,
}: Props) {
  const { isSignedIn } = useAuth();
  const reduceMotion = useReducedMotion();
  const countActive = !reduceMotion;
  const blurSlots = phase === "preview" ? SLOT_COUNT_PREVIEW : SLOT_COUNT_FULL;

  const [{ h, m }, setHm] = useState(() => {
    const target = new Date(resetAt).getTime();
    return formatHm(Math.max(0, target - Date.now()));
  });

  const posted2hRaw = useMemo(() => countPostedInLast2Hours(previewJobs), [previewJobs]);
  const posted2hTarget = useMemo(() => {
    if (posted2hRaw > 0) return posted2hRaw;
    return Math.max(3, Math.min(48, Math.round(Math.max(0, count) * 0.04 + 8)));
  }, [posted2hRaw, count]);

  const nHidden = useCountUp(Math.max(0, count), 1000, countActive);
  const n2h = useCountUp(posted2hTarget, 1050, countActive);

  useEffect(() => {
    const target = new Date(resetAt).getTime();
    const tick = () => setHm(formatHm(Math.max(0, target - Date.now())));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [resetAt]);

  const featureVariants = {
    hidden: {},
    visible: {
      transition: { staggerChildren: 0.12, delayChildren: 0.15 },
    },
  };
  const featureItem = {
    hidden: { opacity: 0, y: 10 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.4, ease: motionEase },
    },
  };

  const headline =
    phase === "preview"
      ? "You're out of free discovery for today"
      : "Most matches are still hidden on Free";

  const subcopy =
    phase === "preview"
      ? "Only a tiny preview stays visible above — the rest of the list stays blurred until you upgrade or your limit resets."
      : "You're browsing a short slice of what exists. Pro shows the full list as it changes.";

  return (
    <div
      className="mt-8 overflow-hidden rounded-3xl border border-ink/[0.06] bg-gradient-to-b from-white via-[#faf8f5] to-canvas text-left shadow-[0_22px_55px_-26px_rgba(0,0,0,0.11)] ring-1 ring-black/[0.025]"
      style={{
        borderLeftWidth: 4,
        borderLeftColor: CORAL,
        borderLeftStyle: "solid",
      }}
      aria-labelledby="limit-wall-heading"
    >
      <div
        id="limit-wall-heading"
        className="px-5 pb-7 pt-6 sm:px-7 sm:pb-8 sm:pt-8"
      >
        <div className="flex items-start gap-4 sm:gap-5">
          <div
            className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_24px_-12px_rgba(232,83,58,0.35)] ring-1 ring-ink/[0.06]"
            aria-hidden
          >
            <LockIconCoral size={26} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink/38">
              {phase === "preview" ? "Limit reached" : "Free tier"}
            </p>
            <h2
              className="mt-1.5 font-sans text-[1.35rem] font-bold leading-snug tracking-tight text-ink sm:text-2xl"
              style={{ color: INK }}
            >
              {headline}
            </h2>
            {phase === "preview" ? (
              <ScrollCollapseChrome
                show={scrollRevealSubcopy}
                className={cn(
                  "transition-[margin-top] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                  scrollRevealSubcopy ? "mt-2" : "mt-0",
                )}
              >
                <p className="max-w-2xl font-sans text-sm font-normal leading-relaxed tracking-normal text-ink/68">
                  {subcopy}
                </p>
              </ScrollCollapseChrome>
            ) : (
              <p className="mt-2 max-w-2xl font-sans text-sm font-normal leading-relaxed tracking-normal text-ink/68">
                {subcopy}
              </p>
            )}

            <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 sm:gap-6">
              <div className="sm:col-span-1 lg:col-span-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">
                  Beyond your free view
                </p>
                <p className="mt-0.5 text-[10px] text-ink/40">
                  Estimated from this search (not exact)
                </p>
                <p className="mt-1 text-lg font-bold tabular-nums" style={{ color: CORAL }}>
                  {nHidden.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">
                  Fresh in last 2 hours
                </p>
                <p className="mt-1 text-lg font-bold tabular-nums" style={{ color: CORAL }}>
                  {n2h.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">
                  Resets in
                </p>
                <p className="mt-1 text-lg font-bold tabular-nums" style={{ color: CORAL }}>
                  {h}h {m}m
                </p>
              </div>
            </div>

            <motion.ul
              className="mt-8 space-y-3 border-t border-ink/10 pt-6"
              initial="hidden"
              animate="visible"
              variants={featureVariants}
              aria-label="Pro features"
            >
              {[
                {
                  k: "auto",
                  icon: "⚡",
                  line: "Smart Apply → Fill ATS forms fast; you review and submit",
                },
                { k: "resume", icon: "🎯", line: "Resume match → Know before you apply" },
                {
                  k: "alerts",
                  icon: "📧",
                  line: "Email job alerts → Get notified when new roles match your saved searches",
                },
              ].map((row) => (
                <motion.li
                  key={row.k}
                  variants={reduceMotion ? { hidden: { opacity: 1 }, visible: { opacity: 1 } } : featureItem}
                  className="flex items-start gap-2 text-sm text-ink/80"
                >
                  <span aria-hidden className="shrink-0">
                    {row.icon}
                  </span>
                  <span>{row.line}</span>
                </motion.li>
              ))}
            </motion.ul>

            <div className="mt-8 flex flex-col gap-3">
              <Link
                href="/pricing"
                className="block w-full text-center font-bold text-white no-underline transition-opacity hover:opacity-95"
                style={{
                  backgroundColor: CORAL,
                  borderRadius: 10,
                  padding: 14,
                  fontSize: 15,
                  fontWeight: 700,
                }}
              >
                See what you&apos;re missing →
              </Link>
              {!isSignedIn ? (
                <SignInButton mode="modal">
                  <button
                    type="button"
                    className="w-full rounded-[10px] border border-ink/10 bg-transparent py-3 text-[15px] font-semibold text-ink/80 transition-colors hover:bg-ink/[0.04]"
                  >
                    Sign in to save your progress
                  </button>
                </SignInButton>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="relative min-h-[17rem] overflow-hidden sm:min-h-[19rem]">
        <div className="relative z-0 px-5 pb-28 pt-5 sm:px-7 sm:pb-32 sm:pt-6">
          <LimitPreviewBlurStack key={phase} slotCount={blurSlots} />
        </div>
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 top-[60%] bg-gradient-to-t from-canvas via-canvas/80 to-transparent"
          aria-hidden
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] px-5 pb-8 pt-20 sm:px-7 sm:pb-10">
          <div className="max-w-lg">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ink/38">
              More Jobs that match your search
            </p>
            <p className="mt-2.5 text-sm font-medium leading-relaxed text-ink/55 sm:text-[15px]">
              Upgrade for unlimited browsing and the live list.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
