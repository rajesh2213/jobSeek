"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { cn } from "../../lib/cn";

const STATE_COUNT = 3;
const ROTATE_MS = 3500;

const ease = [0.22, 1, 0.36, 1] as const;

export function JobsHeroDemoCard() {
  const [state, setState] = useState(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) return;
    const id = window.setInterval(() => {
      setState((v) => (v + 1) % STATE_COUNT);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [reduceMotion]);

  return (
    <div className="relative mx-auto w-full max-w-[380px] lg:mx-0 lg:ml-auto">
      <motion.div
        className="will-change-transform"
        animate={reduceMotion ? undefined : { y: [0, -6, 0] }}
        transition={{
          duration: 5.5,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        <div
          className={cn(
            "relative overflow-hidden rounded-2xl bg-surface/90 p-5 shadow-[0_1px_0_0_rgba(0,0,0,0.04)] ring-1 ring-ink/[0.07]",
            "backdrop-blur-sm",
          )}
        >
          <div className="relative min-h-[168px]">
            <AnimatePresence mode="wait" initial={false}>
              {state === 0 ? (
                <DemoStateEarly key="s0" />
              ) : state === 1 ? (
                <DemoStateMatch key="s1" />
              ) : (
                <DemoStatePipeline key="s2" />
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function DemoStateEarly() {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className="space-y-3"
      initial={reduceMotion ? false : { opacity: 0, y: 14, rotate: -1.2 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, y: -12, rotate: 1.2 }}
      transition={{ duration: 0.4, ease }}
    >
      <p className="text-[11px] font-bold uppercase tracking-wide text-ink/40">Fresh listing</p>
      <p className="text-sm font-semibold text-ink">Posted 2 mins ago</p>
      <p className="text-sm text-ink/70">
        Applicants: <span className="tabular-nums font-semibold text-ink">3</span>
      </p>
      <span className="inline-flex rounded-full bg-emerald-500/12 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
        You&apos;re early
      </span>
    </motion.div>
  );
}

function DemoStateMatch() {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className="space-y-3"
      initial={reduceMotion ? false : { opacity: 0, y: 14, rotate: -1.2 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, y: -12, rotate: 1.2 }}
      transition={{ duration: 0.4, ease }}
    >
      <p className="text-[11px] font-bold uppercase tracking-wide text-ink/40">Resume fit</p>
      <p className="text-lg font-bold tabular-nums text-ink">
        Match score: <span className="text-brand">87%</span>
      </p>
      <ul className="space-y-1 text-[13px] text-ink/75">
        <li className="flex gap-2">
          <span className="text-emerald-600 dark:text-emerald-400">✓</span>
          TypeScript, React
        </li>
        <li className="flex gap-2">
          <span className="text-emerald-600 dark:text-emerald-400">✓</span>
          System design
        </li>
        <li className="flex gap-2">
          <span className="text-ink/35">○</span>
          <span className="text-ink/50">Kubernetes — add to stand out</span>
        </li>
      </ul>
    </motion.div>
  );
}

function DemoStatePipeline() {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className="space-y-4"
      initial={reduceMotion ? false : { opacity: 0, y: 14, rotate: -1.2 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, y: -12, rotate: 1.2 }}
      transition={{ duration: 0.4, ease }}
    >
      <p className="text-[11px] font-bold uppercase tracking-wide text-ink/40">Application pipeline</p>
      <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-ink/80">
        <span className="rounded-lg bg-brand/10 px-2.5 py-1 text-brand ring-1 ring-brand/20">Applied</span>
        <span className="text-ink/30" aria-hidden>
          →
        </span>
        <span className="rounded-lg bg-ink/[0.06] px-2.5 py-1 text-ink/70">Interview</span>
        <span className="text-ink/30" aria-hidden>
          →
        </span>
        <span className="rounded-lg bg-ink/[0.06] px-2.5 py-1 text-ink/70">Offer</span>
      </div>
      <p className="text-xs leading-relaxed text-ink/50">One timeline — follow-ups and assessments included.</p>
    </motion.div>
  );
}
