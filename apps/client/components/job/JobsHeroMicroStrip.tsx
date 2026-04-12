"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { cn } from "../../lib/cn";

const ITEMS = [
  "⚡ Applied in 2 minutes",
  "🎯 Resume match: 87%",
  "📩 Email tracking — coming soon",
] as const;

const INTERVAL_MS = 2600;

export function JobsHeroMicroStrip({ className }: { className?: string }) {
  const [idx, setIdx] = useState(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) return;
    const id = window.setInterval(() => {
      setIdx((v) => (v + 1) % ITEMS.length);
    }, INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [reduceMotion]);

  return (
    <div
      className={cn(
        "mt-6 flex h-10 items-center overflow-hidden rounded-xl bg-ink/[0.04] px-4 ring-1 ring-ink/[0.06] dark:bg-white/[0.05]",
        className,
      )}
      aria-live="polite"
      aria-label="Product highlights"
    >
      <span className="mr-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400/90" aria-hidden />
      <div className="relative min-h-[1.25rem] min-w-0 flex-1">
        {reduceMotion ? (
          <span className="text-[13px] font-medium text-ink/60">{ITEMS[0]}</span>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={ITEMS[idx]}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-x-0 top-0 text-[13px] font-medium text-ink/60"
            >
              {ITEMS[idx]}
            </motion.span>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
