"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SignInButton, useAuth } from "@clerk/nextjs";
import type { JobItem } from "../../lib/api";
import { motionEase } from "../../lib/motion";

const CORAL = "#E8533A";
const INK = "#1a1a1a";

const FAKE_JOBS = [
  { title: "Backend Engineer — Stripe" },
  { title: "Product Analyst — Notion" },
  { title: "Frontend Engineer — Vercel" },
  { title: "Data Scientist — OpenAI" },
  { title: "Designer — Linear" },
  { title: "Platform Engineer — Datadog" },
] as const;

const SLOT_COUNT = 4;
const NEW_BADGE_MS = 10_000;
const CARD_MOTION = { duration: 0.4, ease: "easeOut" as const };

type BlurJobSlot = {
  id: number;
  title: string;
  applicants: number;
  replacedAt: number;
};

function randomFakeJob(): (typeof FAKE_JOBS)[number] {
  return FAKE_JOBS[Math.floor(Math.random() * FAKE_JOBS.length)];
}

/** Deterministic first paint so SSR and hydration match (no Math.random / Date.now in initial state). */
function initialSlots(): BlurJobSlot[] {
  return Array.from({ length: SLOT_COUNT }, (_, i) => {
    const j = FAKE_JOBS[i % FAKE_JOBS.length];
    return {
      id: i,
      title: j.title,
      applicants: 18 + i * 7,
      replacedAt: 0,
    };
  });
}

function LimitBlurFakeJobCard({
  job,
  reduceMotion,
}: {
  job: BlurJobSlot;
  reduceMotion: boolean;
}) {
  const showNew =
    job.replacedAt > 0 && Date.now() - job.replacedAt < NEW_BADGE_MS;

  return (
    <div
      className="flex h-40 flex-col justify-between rounded-2xl border border-ink/[0.06] bg-white p-4 shadow-sm"
      aria-hidden
    >
      <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-ink/35">
            Posted moments ago
          </span>
          {showNew ? (
            <motion.span
              className="rounded-full bg-brand px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-white ring-1 ring-brand/40"
              initial={reduceMotion ? false : { opacity: 0.5 }}
              animate={
                reduceMotion
                  ? { opacity: 1 }
                  : { opacity: [0.5, 1, 0.5] }
              }
              transition={
                reduceMotion
                  ? {}
                  : { duration: 1.2, repeat: Infinity, ease: "easeInOut" }
              }
            >
              NEW
            </motion.span>
          ) : null}
        </div>
        <p className="line-clamp-2 text-sm font-semibold leading-snug text-ink">
          {job.title}
        </p>
      </div>
      <p className="text-[11px] font-medium tabular-nums text-ink/45">
        {job.applicants}+ applicants
      </p>
    </div>
  );
}

function LimitPreviewBlurStack({ reduceMotion }: { reduceMotion: boolean | null }) {
  const [visibleJobs, setVisibleJobs] = useState<BlurJobSlot[]>(initialSlots);
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const addRandomJob = useCallback(() => {
    const pick = randomFakeJob();
    setVisibleJobs((prev) => {
      const next = [...prev];
      const replaceIndex = Math.floor(Math.random() * next.length);
      next[replaceIndex] = {
        id: Date.now(),
        title: pick.title,
        applicants: 10 + Math.floor(Math.random() * 42),
        replacedAt: Date.now(),
      };
      return next;
    });
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    let timeoutId: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const scheduleNext = () => {
      const delay = 3000 + Math.random() * 7000;
      timeoutId = setTimeout(() => {
        if (cancelled) return;
        addRandomJob();
        scheduleNext();
      }, delay);
    };

    scheduleNext();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [addRandomJob, reduceMotion]);

  useEffect(() => {
    if (reduceMotion) return;
    const id = window.setInterval(() => {
      setVisibleJobs((prev) => {
        const next = [...prev];
        const i = Math.floor(Math.random() * next.length);
        const bump = 1 + Math.floor(Math.random() * 3);
        next[i] = {
          ...next[i],
          applicants: next[i].applicants + bump,
        };
        return next;
      });
    }, 8000);
    return () => window.clearInterval(id);
  }, [reduceMotion]);

  return (
    <div
      className="pointer-events-none flex select-none flex-col gap-5 opacity-[0.75]"
      style={{ filter: "blur(6px)" }}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {visibleJobs.map((job) => (
          <motion.div
            key={job.id}
            layout
            initial={
              reduceMotion ? false : { opacity: 0, y: 8, scale: 0.98 }
            }
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={CARD_MOTION}
            className="h-40 will-change-transform"
            style={{ transformOrigin: "50% 0%" }}
          >
            <LimitBlurFakeJobCard job={job} reduceMotion={!!reduceMotion} />
          </motion.div>
        ))}
      </AnimatePresence>
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

interface Props {
  resetAt: string;
  count: number;
  previewJobs: JobItem[];
}

function countPostedInLast2Hours(jobs: JobItem[]): number {
  const now = Date.now();
  const twoH = 2 * 60 * 60 * 1000;
  return jobs.filter((j) => {
    const iso = j.postedAt ?? j.createdAt;
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

function fakeApplicants10Plus(hiddenCount: number): number {
  const c = Math.max(0, hiddenCount);
  return Math.max(12, Math.min(c || 9999, Math.round(c * 0.08 + 20)));
}

export function LimitWallEnhanced({ resetAt, count, previewJobs }: Props) {
  const { isSignedIn } = useAuth();
  const reduceMotion = useReducedMotion();
  const countActive = !reduceMotion;

  const [{ h, m }, setHm] = useState(() => {
    const target = new Date(resetAt).getTime();
    return formatHm(Math.max(0, target - Date.now()));
  });

  const posted2hRaw = useMemo(() => countPostedInLast2Hours(previewJobs), [previewJobs]);
  const posted2hTarget = useMemo(() => {
    if (posted2hRaw > 0) return posted2hRaw;
    return Math.max(3, Math.min(48, Math.round(count * 0.04 + 8)));
  }, [posted2hRaw, count]);

  const applicantsTarget = useMemo(() => fakeApplicants10Plus(count), [count]);

  const nHidden = useCountUp(Math.max(0, count), 1000, countActive);
  const n2h = useCountUp(posted2hTarget, 1050, countActive);
  const nApplicants = useCountUp(applicantsTarget, 1100, countActive);

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

  return (
    <div className="mt-6 space-y-5" aria-labelledby="limit-wall-heading">
      <div
        id="limit-wall-heading"
        className="jobseek-daily-cap-highlight rounded-2xl pl-6 pr-6 pt-7 pb-7 text-left"
        style={{
          border: "1px solid rgba(0,0,0,0.06)",
          borderLeft: `4px solid ${CORAL}`,
          background: "linear-gradient(135deg, #ffffff 0%, #fff8f6 55%, #F5F2EB 100%)",
        }}
      >
        <div className="flex items-start gap-4">
          <div className="mt-0.5 shrink-0" aria-hidden>
            <LockIconCoral size={28} />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              className="font-sans text-xl font-bold leading-snug tracking-tight text-ink"
              style={{ color: INK }}
            >
              You&apos;re ahead — but only for what you can see.
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink/65">
              You&apos;ve hit today&apos;s free view limit. Everything below is still moving — you
              just can&apos;t see it yet.
            </p>

            <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 sm:gap-6">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">
                  Roles you haven&apos;t seen yet
                </p>
                <p className="mt-1 text-lg font-bold tabular-nums" style={{ color: CORAL }}>
                  {nHidden.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">
                  Posted in last 2 hours
                </p>
                <p className="mt-1 text-lg font-bold tabular-nums" style={{ color: CORAL }}>
                  {n2h.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">
                  Already have 10+ applicants
                </p>
                <p className="mt-1 text-lg font-bold tabular-nums" style={{ color: CORAL }}>
                  {nApplicants.toLocaleString()}
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
                  line: "Smart Apply ⚡ — Fill ATS forms fast; you review and submit",
                },
                { k: "resume", icon: "🎯", line: "Resume match → Know before you apply" },
                {
                  k: "track",
                  icon: "📩",
                  line: "Email tracking — Coming soon (application tracker included with Pro)",
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

      <div className="relative isolate overflow-hidden rounded-2xl">
        <LimitPreviewBlurStack reduceMotion={reduceMotion} />
        <div
          className="pointer-events-none absolute inset-0 rounded-2xl"
          style={{
            background: "linear-gradient(to bottom, rgba(245,242,235,0.35), rgba(245,242,235,0.96))",
          }}
          aria-hidden
        />
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-center px-6 py-8 sm:px-10 sm:py-10">
          <div className="mx-auto max-w-lg text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ink/40">Preview</p>
            <p className="mt-3 text-sm leading-relaxed text-ink/55 sm:text-[15px]">
              Your filters still apply. Upgrade to scroll the full list in real time.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
