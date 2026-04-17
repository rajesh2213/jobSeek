"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useMotionTemplate, useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import { ComingSoonPill } from "./ui/ComingSoonPill";

/* ═══════════════════════ Config ═══════════════════════ */

const CARD_DURATION = 7000;
const CARDS = ["early", "resume", "email"] as const;
type CardKey = (typeof CARDS)[number];

const LABELS: Record<CardKey, string> = {
  early: "Apply early ",
  resume: "Match better",
  email: "Miss nothing",
};

const ACCENT: Record<CardKey, { text: string; dot: string; border: string }> = {
  early: {
    text: "text-amber-600",
    dot: "rgb(245,158,11)",
    border: "rgba(245,158,11,0.22)",
  },
  resume: {
    text: "text-emerald-600",
    dot: "rgb(16,185,129)",
    border: "rgba(16,185,129,0.22)",
  },
  email: {
    text: "text-blue-600",
    dot: "rgb(59,130,246)",
    border: "rgba(59,130,246,0.22)",
  },
};

const EARLY_T = [1200, 900, 700, 1000, 1000] as const;
const RESUME_T = [1200, 1000, 800, 1000, 1000] as const;
const EMAIL_T = [1000, 1000, 800, 1000, 1000] as const;
const CARD_TIMELINE_MS: Record<CardKey, number> = {
  early: EARLY_T.reduce((a, b) => a + b, 0),
  resume: RESUME_T.reduce((a, b) => a + b, 0),
  email: EMAIL_T.reduce((a, b) => a + b, 0),
};

const KEYWORDS = ["Kafka", "Distributed systems", "Terraform"];

const INBOX = [
  { subject: "Complete your assessment", from: "Stripe", time: "2d" },
  { subject: "Interview this Thursday?", from: "Notion", time: "1d" },
  { subject: "Next steps for your role", from: "Figma", time: "3d" },
  { subject: "Reminder: Submit by Friday", from: "Stripe", time: "5h" },
];

const CHAOS_OFFSETS = [
  { rotate: -1.5, x: 4 },
  { rotate: 1, x: -3 },
  { rotate: -0.7, x: 5 },
  { rotate: 1.8, x: -4 },
];

const PIPELINE = [
  { label: "Applied", icon: "✅" },
  { label: "Assessment", icon: "⏳" },
  { label: "Interview", icon: "🔜" },
  { label: "Offer", icon: "🎯" },
];


/* ═══════════════════════ Hooks ═══════════════════════ */

function useTimeline(durations: readonly number[]) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const ids: ReturnType<typeof setTimeout>[] = [];
    let t = 0;
    for (let i = 0; i < durations.length; i++) {
      t += durations[i];
      const s = i + 1;
      ids.push(setTimeout(() => setStep(s), t));
    }
    return () => ids.forEach(clearTimeout);
  }, [durations]);
  return step;
}

function AnimNum({ value, ms = 650 }: { value: number; ms?: number }) {
  const [d, setD] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value) {
      setD(value);
      return;
    }
    let t0: number | null = null;
    let id: number;
    const tick = (ts: number) => {
      if (!t0) t0 = ts;
      const p = Math.min((ts - t0) / ms, 1);
      setD(Math.round(from + (value - from) * (1 - (1 - p) ** 3)));
      if (p < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [value, ms]);
  return <>{d}</>;
}

/* ═══════════════════════ Card 1 — Apply Early ═══════════════════════ */

function ApplyEarlyCard() {
  const step = useTimeline(EARLY_T);

  const isLate = step <= 2;
  const isShaking = step === 1;
  const isEarly = step >= 3;
  const showBadge = step >= 4;
  const showCTA = step >= 5;

  const applicants = isLate ? 152 : 3;
  const posted = isLate ? "2 hours ago" : "2 minutes ago";

  const tag = isLate ? "You're late" : "You're early";
  const tagCls = isLate
    ? "bg-red-100 text-red-600"
    : "bg-emerald-100 text-emerald-700";

  return (
    <div className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-ink/35">
            Notion
          </p>
          <p className="text-sm font-bold text-ink sm:text-base">
            Product Analyst
          </p>
          <p className="text-[11px] text-ink/40">
            San Francisco · $145k–$190k
          </p>
        </div>
        <motion.span
          key={tag}
          initial={{ opacity: 0, x: 6 }}
          animate={{ opacity: 1, x: 0 }}
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tagCls}`}
        >
          {tag}
        </motion.span>
      </div>

      {/* Posted + applicants */}
      <motion.div
        className="mt-4 rounded-xl border p-3"
        animate={{
          opacity: step === 2 ? 0.3 : 1,
          borderColor: isEarly
            ? "rgba(16,185,129,0.25)"
            : isShaking
              ? "rgba(239,68,68,0.3)"
              : "rgba(0,0,0,0.06)",
          backgroundColor: isEarly
            ? "rgba(16,185,129,0.04)"
            : isShaking
              ? "rgba(239,68,68,0.03)"
              : "rgba(0,0,0,0.015)",
        }}
        transition={{ duration: 0.35 }}
      >
        <motion.div
          className="flex items-end justify-between"
          animate={isShaking ? { x: [0, -3, 3, -2, 2, 0] } : { x: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-ink/40">
              Posted
            </p>
            <AnimatePresence mode="wait">
              <motion.p
                key={posted}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="mt-0.5 text-sm font-bold text-ink"
              >
                {posted}
              </motion.p>
            </AnimatePresence>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider text-ink/40">
              Applicants
            </p>
            <p
              className={`text-2xl font-extrabold tabular-nums leading-tight ${isLate ? "text-red-500" : "text-emerald-500"}`}
            >
              <AnimNum value={applicants} ms={900} />
            </p>
          </div>
        </motion.div>
      </motion.div>

      {/* Narrative */}
      <AnimatePresence mode="wait">
        {step === 0 && (
          <motion.p
            key="n0"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            className="mt-2.5 text-center text-[11px] font-semibold text-red-500"
          >
            152 people already applied. You're competing with everyone.
          </motion.p>
        )}
        {isShaking && (
          <motion.p
            key="n1"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            className="mt-2.5 text-center text-[11px] font-semibold text-red-500/80"
          >
            The window is already closing.
          </motion.p>
        )}
        {step === 3 && (
          <motion.p
            key="n3"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            className="mt-2.5 text-center text-[11px] font-semibold text-emerald-600"
          >
            Only 3 applicants. You're in the first wave.
          </motion.p>
        )}
      </AnimatePresence>

      {/* Smart Apply badge */}
      <AnimatePresence>
        {showBadge && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -6 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="mt-2.5 flex justify-center"
          >
            <motion.span
              animate={{ scale: [1, 1.025, 1] }}
              transition={{ repeat: Infinity, duration: 2.1, ease: "easeInOut" }}
              className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-bold text-amber-700"
            >
              ⚡ Smart Apply in &lt; 2 mins
            </motion.span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* CTA */}
      <AnimatePresence>
        {showCTA && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="mt-2.5 text-center"
          >
            <motion.span
              animate={{
                boxShadow: [
                  "0 0 0 0 rgba(245,158,11,0.3)",
                  "0 0 0 6px rgba(245,158,11,0)",
                ],
              }}
              transition={{ repeat: Infinity, duration: 1.5 }}
              className="inline-block rounded-full bg-amber-500 px-4 py-1.5 text-[11px] font-bold text-white"
            >
              Apply before everyone else →
            </motion.span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ═══════════════════════ Card 2 — Resume Fit ═══════════════════════ */

function ResumeFitCard() {
  const step = useTimeline(RESUME_T);

  const showKw = step >= 1;
  const kwFixed = step >= 3;
  const scoreUp = step >= 4;
  const success = step >= 5;

  const score = scoreUp ? 87 : 42;
  const barCls = kwFixed ? "bg-emerald-500" : "bg-red-400";
  const numCls = kwFixed ? "text-emerald-500" : "text-red-500";

  const tag = success
    ? "Competitive"
    : kwFixed
      ? "Optimized"
      : step >= 2
        ? "Missing keywords"
        : step >= 1
          ? "Weak match"
          : "Low match";
  const tagCls = kwFixed
    ? "bg-emerald-100 text-emerald-700"
    : step >= 2
      ? "bg-amber-100 text-amber-700"
      : "bg-red-100 text-red-600";

  return (
    <div className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-ink/35">
            Stripe
          </p>
          <p className="text-sm font-bold text-ink sm:text-base">
            Senior Backend Engineer
          </p>
          <p className="text-[11px] text-ink/40">
            San Francisco · $180k–$250k
          </p>
        </div>
        <motion.span
          key={tag}
          initial={{ opacity: 0, x: 6 }}
          animate={{ opacity: 1, x: 0 }}
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tagCls}`}
        >
          {tag}
        </motion.span>
      </div>

      {/* Match score */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink/40">
            Match score
          </span>
          <span className={`text-xl font-extrabold tabular-nums ${numCls}`}>
            <AnimNum value={score} ms={800} />%
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink/6">
          <motion.div
            className={`h-full rounded-full ${barCls}`}
            animate={{ width: `${score}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />
        </div>
      </div>

      {/* Narrative */}
      <AnimatePresence mode="wait">
        {step === 2 && (
          <motion.p
            key="kn"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="mt-2.5 text-center text-[11px] font-semibold text-amber-600"
          >
            Missing critical keywords. ATS will filter you out.
          </motion.p>
        )}
      </AnimatePresence>

      {/* Keywords */}
      <AnimatePresence>
        {showKw && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="mt-3 rounded-xl border border-ink/8 bg-canvas/70 p-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink/40">
                {kwFixed ? "Keywords optimized" : "Missing keywords"}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {KEYWORDS.map((kw, i) => (
                  <motion.span
                    key={`${kw}-${kwFixed}`}
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{
                      opacity: 1,
                      scale: 1,
                      boxShadow: kwFixed
                        ? "0 0 6px rgba(16,185,129,0.25)"
                        : "0 0 6px rgba(239,68,68,0.25)",
                    }}
                    transition={{ delay: i * 0.14, duration: 0.3 }}
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                      kwFixed
                        ? "border border-emerald-200 bg-emerald-50 text-emerald-600"
                        : "border border-red-200 bg-red-50 text-red-600"
                    }`}
                  >
                    {kwFixed && <span className="mr-1">✓</span>}
                    {kw}
                  </motion.span>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Success CTA */}
      <AnimatePresence>
        {success && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="mt-2.5 text-center"
          >
            <motion.span
              animate={{
                boxShadow: [
                  "0 0 0 0 rgba(16,185,129,0.3)",
                  "0 0 0 6px rgba(16,185,129,0)",
                ],
              }}
              transition={{ repeat: Infinity, duration: 1.5 }}
              className="inline-block rounded-full bg-emerald-500 px-4 py-1.5 text-[11px] font-bold text-white"
            >
              Now you're competitive →
            </motion.span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ═══════════════════════ Card 3 — Email Tracking ═══════════════════════ */

function EmailTrackingCard() {
  const step = useTimeline(EMAIL_T);

  const showInbox = step <= 2;
  const isChaos = step >= 1 && step <= 2;
  const showPipeline = step >= 3;
  const isSuccess = step >= 5;

  const tag =
    step <= 2 ? "Missed" : step <= 3 ? "Organizing…" : "Tracked";
  const tagCls =
    step <= 2
      ? "bg-red-100 text-red-600"
      : step <= 3
        ? "bg-amber-100 text-amber-700"
        : "bg-blue-100 text-blue-600";

  return (
    <div className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-ink/35">
            Application emails
          </p>
          <p className="text-sm font-bold text-ink sm:text-base">
            4 unread updates
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <ComingSoonPill />
          <motion.span
            key={tag}
            initial={{ opacity: 0, x: 6 }}
            animate={{ opacity: 1, x: 0 }}
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tagCls}`}
          >
            {tag}
          </motion.span>
        </div>
      </div>

      {/* Content area — inbox or pipeline (demo; live email sync coming soon) */}
      <div className="relative mt-4">
        <AnimatePresence mode="wait">
          {showInbox ? (
            <motion.div
              key="inbox"
              exit={{
                opacity: 0,
                scale: 0.95,
                filter: "blur(3px)",
              }}
              transition={{ duration: 0.3 }}
              className="space-y-1.5"
            >
              {INBOX.map((email, i) => {
                const missed = isChaos && (i === 0 || i === 2);
                return (
                  <motion.div
                    key={email.subject}
                    initial={{ opacity: 0, x: 30 }}
                    animate={{
                      opacity: isChaos ? (missed ? 0.45 : 0.7) : 1,
                      x: isChaos ? CHAOS_OFFSETS[i].x : 0,
                      rotate: isChaos ? CHAOS_OFFSETS[i].rotate : 0,
                    }}
                    transition={{
                      delay: step === 0 ? i * 0.1 : 0,
                      duration: 0.25,
                    }}
                    className="relative flex items-center gap-2 rounded-lg border border-ink/8 bg-white px-2.5 py-1.5"
                  >
                    <span className="text-xs">✉️</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-semibold text-ink">
                        {email.subject}
                      </p>
                      <p className="text-[10px] text-ink/35">
                        {email.from} · {email.time}
                      </p>
                    </div>
                    {missed && (
                      <motion.span
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-bold text-red-500"
                      >
                        Missed
                      </motion.span>
                    )}
                  </motion.div>
                );
              })}
            </motion.div>
          ) : (
            <motion.div
              key="pipeline"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.35 }}
            >
              <div className="rounded-xl border border-blue-200/60 bg-blue-50/30 p-3">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-blue-400">
                  Application pipeline
                </p>
                <div className="flex items-center">
                  {PIPELINE.map((s, i) => (
                    <Fragment key={s.label}>
                      <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: i * 0.12, duration: 0.25 }}
                        className="flex flex-col items-center gap-0.5"
                      >
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-sm">
                          {s.icon}
                        </div>
                        <span className="text-[9px] font-semibold text-ink/45">
                          {s.label}
                        </span>
                      </motion.div>
                      {i < PIPELINE.length - 1 && (
                        <motion.div
                          className="mx-1 h-0.5 flex-1 rounded-full bg-blue-200"
                          initial={{ scaleX: 0 }}
                          animate={{ scaleX: 1 }}
                          transition={{
                            delay: i * 0.12 + 0.08,
                            duration: 0.2,
                          }}
                          style={{ transformOrigin: "left" }}
                        />
                      )}
                    </Fragment>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Narrative + CTA */}
      <AnimatePresence mode="wait">
        {step === 2 && (
          <motion.p
            key="chaos"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="mt-2 text-center text-[11px] font-semibold text-red-500"
          >
            Missed important updates. Opportunities lost.
          </motion.p>
        )}
        {isSuccess && (
          <motion.div
            key="ok"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="mt-2 text-center"
          >
            <motion.span
              animate={{
                boxShadow: [
                  "0 0 0 0 rgba(59,130,246,0.3)",
                  "0 0 0 6px rgba(59,130,246,0)",
                ],
              }}
              transition={{ repeat: Infinity, duration: 1.5 }}
              className="inline-block rounded-full bg-blue-500 px-4 py-1.5 text-[11px] font-bold text-white"
            >
              Everything tracked. Nothing missed.
            </motion.span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ═══════════════════════ Main ═══════════════════════ */

export default function GuidedHookDemo() {
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const wasHovered = useRef(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const cycleStartedAt = useRef(Date.now());
  const pausedAt = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const smx = useSpring(mx, { stiffness: 180, damping: 20, mass: 0.45 });
  const smy = useSpring(my, { stiffness: 180, damping: 20, mass: 0.45 });
  const tilt = useMotionTemplate`perspective(1000px) rotateX(${smy}deg) rotateY(${smx}deg)`;

  useEffect(() => {
    const cardNow = CARDS[active];
    const cycleMs = Math.max(CARD_DURATION, CARD_TIMELINE_MS[cardNow] + 1200);
    if (hovered) {
      wasHovered.current = true;
      pausedAt.current = Date.now();
      return;
    }
    const elapsed = Math.max(
      0,
      (pausedAt.current ?? Date.now()) - cycleStartedAt.current,
    );
    const delay = wasHovered.current ? Math.max(1100, cycleMs - elapsed) : cycleMs;
    pausedAt.current = null;
    wasHovered.current = false;
    const id = setTimeout(
      () => {
        setActive((p) => (p + 1) % CARDS.length);
      },
      delay,
    );
    return () => clearTimeout(id);
  }, [active, hovered]);

  useEffect(() => {
    cycleStartedAt.current = Date.now();
    pausedAt.current = null;
  }, [active]);

  const card = CARDS[active];
  const cardTint = ACCENT[card].dot.replace("rgb", "rgba").replace(")", ",0.16)");
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!hovered || prefersReducedMotion) return;
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      mx.set((px - 0.5) * 2.2);
      my.set((0.5 - py) * 2.2);
      rafRef.current = null;
    });
  };
  const resetTilt = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    mx.set(0);
    my.set(0);
  };

  return (
    <motion.div
      ref={wrapRef}
      className="relative mx-auto w-full max-w-xl select-none will-change-transform"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        resetTilt();
      }}
      onMouseMove={onMove}
      whileHover={prefersReducedMotion ? undefined : { scale: 1.008 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      style={{ transform: prefersReducedMotion ? "perspective(1000px) rotateX(0deg) rotateY(0deg)" : tilt }}
    >
      <div className="absolute -inset-3 -z-10 rotate-2 rounded-3xl bg-white/70 shadow-[0_20px_60px_rgba(20,20,20,0.12)]" />
      <div className="absolute -inset-2 -z-[9] rotate-1 rounded-3xl border border-ink/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.82)_0%,rgba(248,246,242,0.66)_100%)] shadow-[0_10px_28px_rgba(20,20,20,0.08)]" />

      {/* Feature tabs */}
      <div className="mb-2 flex items-center justify-center gap-1">
        <span className="mr-1 h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
        {CARDS.map((c, i) => (
          <button
            key={c}
            onClick={() => setActive(i)}
            className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-all duration-300 ${
              i === active
                ? `bg-white shadow-sm ${ACCENT[c].text}`
                : "text-ink/25 hover:text-ink/45"
            }`}
          >
            {LABELS[c]}
          </button>
        ))}
      </div>

      {/* Card */}
      <motion.div
        className="relative -rotate-1 overflow-hidden rounded-2xl border bg-white shadow-[0_14px_40px_rgba(0,0,0,0.08)]"
        animate={{ borderColor: ACCENT[card].border }}
        transition={{ duration: 0.35 }}
      >
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[2]"
          animate={hovered && !prefersReducedMotion ? { opacity: [0, 0.18, 0] } : { opacity: 0 }}
          transition={hovered && !prefersReducedMotion ? { duration: 2.1, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
          style={{ background: `linear-gradient(112deg, transparent 22%, ${cardTint} 50%, transparent 80%)` }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[1] opacity-[0.08]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(20,20,20,0.04) 0px, rgba(20,20,20,0.04) 1px, transparent 1px, transparent 5px)",
          }}
        />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={active}
            initial={{ opacity: 0, y: -16, scale: 0.965, rotate: -0.5, clipPath: "inset(0% 0% 84% 0% round 14px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, rotate: 0, clipPath: "inset(0% 0% 0% 0% round 14px)" }}
            exit={{ opacity: 0, y: -8, scale: 0.985, rotate: 0.35, clipPath: "inset(0% 0% 90% 0% round 14px)" }}
            transition={{ duration: 0.62, ease: [0.2, 0.75, 0.22, 1] }}
            className="will-change-transform"
          >
            {card === "early" && <ApplyEarlyCard />}
            {card === "resume" && <ResumeFitCard />}
            {card === "email" && <EmailTrackingCard />}
          </motion.div>
        </AnimatePresence>
      </motion.div>

      {/* Dots */}
      <div className="mt-1 flex justify-center gap-1.5">
        {CARDS.map((c, i) => (
          <motion.button
            key={c}
            onClick={() => setActive(i)}
            className="h-1.5 rounded-full"
            animate={{
              width: i === active ? 20 : 8,
              backgroundColor:
                i === active ? ACCENT[c].dot : "rgba(0,0,0,0.1)",
            }}
            transition={{ duration: 0.3 }}
          />
        ))}
      </div>

      {hovered && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-1 text-center text-[10px] text-ink/25"
        >
          Paused · hover to explore
        </motion.p>
      )}
    </motion.div>
  );
}
