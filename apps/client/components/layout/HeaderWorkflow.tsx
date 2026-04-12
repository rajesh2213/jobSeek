"use client";

import { LayoutGroup, animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  GET_PRO_BUTTON_ID,
  GET_PRO_GLOW_EVENT,
  GET_PRO_GLOW_MS,
  WORKFLOW_ACCOUNT_ENDPOINT_ID,
} from "../../lib/headerWorkflowGlow";
import { useAccountPlan } from "../../lib/useAccountPlan";
import { siteLogoBrandDotRef } from "../../lib/siteLogoBrandDotRef";

const HEADER_H = 64;

/** Dwell on expanded demo before collapsing to pill. */
const EXPAND_MS = 2000;
/** Brief pause after collapse so layout morph can finish before the line moves on. */
const COLLAPSE_LAYOUT_MS = 260;
const BURST_DURATION = 0.6;
const EASE_OUT = [0, 0, 0.2, 1] as const;
const LAYOUT_TRANSITION = { duration: 0.25, ease: [0.22, 1, 0.36, 1] as const };

/** Horizontal reference span for squiggle control points (scaled to dot → Get Pro or account). */
const PATH_REF_W = 820;

/** Inset stroke slightly past dot / before button so the path does not sit on element edges. */
const PATH_ENDPOINT_GAP_PX = 2;

type CheckpointDef = {
  id: number;
  label: string;
  progress: number;
  demoTitle: string;
  demoSubtitle: string;
  /** Optional vertical nudge for pill position (px), positive = down. */
  offsetYPx?: number;
};

const CHECKPOINTS: readonly CheckpointDef[] = [
  {
    id: 0,
    label: "Fresh roles",
    progress: 0.2,
    demoTitle: "🌐 No daily hop across job sites + 📧  Email alerts",
    demoSubtitle:
      "See roles before most ATS & LinkedIn.",
  },
  {
    id: 1,
    label: "Assisted apply",
    progress: 0.4,
    demoTitle: "⚡ Applied in 2 mins",
    demoSubtitle: "Before most people read through it",
  },
  {
    id: 2,
    label: "Optimize Resume",
    progress: 0.65,
    demoTitle: "🎯 Match score tightened",
    demoSubtitle: "Keywords recruiters search for",
    offsetYPx: 6,
  },
  {
    id: 3,
    label: "Track",
    progress: 0.88,
    demoTitle: "📧 One Pipeline",
    demoSubtitle: "Coming soon — Email tracking",
  },
];

function buildSquigglyPathD(
  sx: number,
  sy: number,
  ex: number,
  ey: number,
): string {
  const W = ex - sx;
  const t = (u: number) => sx + (u / PATH_REF_W) * W;
  return `
M ${sx} ${sy}
C ${t(120)} ${sy - 20},
  ${t(220)} ${sy + 30},
  ${t(320)} ${sy}
S ${t(520)} ${sy - 30},
  ${t(640)} ${sy - 4}
S ${t(820)} ${sy - 14},
  ${ex} ${ey}
`
    .replace(/\s+/g, " ")
    .trim();
}

interface LayoutSnapshot {
  width: number;
  sx: number;
  sy: number;
  ex: number;
  ey: number;
}

interface PointOnPath {
  x: number;
  y: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

export function HeaderWorkflow() {
  const reduceMotion = useReducedMotion();
  const { isPro, isLoaded: planLoaded } = useAccountPlan();
  const uid = useId().replace(/:/g, "");
  const gradId = `header-workflow-flow-${uid}`;

  const [layout, setLayout] = useState<LayoutSnapshot | null>(null);
  const [pathLen, setPathLen] = useState(0);
  const [checkpointPoints, setCheckpointPoints] = useState<PointOnPath[]>([]);
  const [activeCheckpoint, setActiveCheckpoint] = useState<number | null>(null);

  const pathRef = useRef<SVGPathElement | null>(null);
  const progress = useMotionValue(0);
  /** Only seed progress when the path first becomes measurable — not on remeasure/resize. */
  const didInitProgress = useRef(false);

  const measure = useCallback(() => {
    if (typeof window === "undefined") return;
    const dotEl =
      siteLogoBrandDotRef.current ??
      document.getElementById("site-logo-brand-dot");
    const endpointId =
      planLoaded && isPro ? WORKFLOW_ACCOUNT_ENDPOINT_ID : GET_PRO_BUTTON_ID;
    const cta = document.getElementById(endpointId);
    if (!dotEl || !cta) return;

    const dot = dotEl.getBoundingClientRect();
    const btn = cta.getBoundingClientRect();
    const w = window.innerWidth;

    const sy = dot.top + dot.height / 2;
    const ey = btn.top + btn.height / 2;

    let sx = dot.left + dot.width + PATH_ENDPOINT_GAP_PX;
    let ex = btn.left - PATH_ENDPOINT_GAP_PX;

    if (ex <= sx) {
      sx = dot.left + dot.width / 2;
      ex = btn.left + btn.width / 2;
    }

    setLayout({
      width: w,
      sx,
      sy,
      ex,
      ey,
    });
  }, [isPro, planLoaded]);

  useLayoutEffect(() => {
    measure();
    requestAnimationFrame(measure);
  }, [measure]);

  useEffect(() => {
    const ro = new ResizeObserver(() => measure());
    ro.observe(document.documentElement);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const pathD = useMemo(() => {
    if (!layout) return "";
    return buildSquigglyPathD(layout.sx, layout.sy, layout.ex, layout.ey);
  }, [layout]);

  useLayoutEffect(() => {
    if (!pathD || !pathRef.current) return;
    const el = pathRef.current;
    const L = el.getTotalLength();
    setPathLen(L);
    const pts = CHECKPOINTS.map((cp) => {
      const p = el.getPointAtLength(L * cp.progress);
      return { x: p.x, y: p.y };
    });
    setCheckpointPoints(pts);
  }, [pathD]);

  useEffect(() => {
    if (!pathLen || didInitProgress.current) return;
    didInitProgress.current = true;
    progress.set(reduceMotion ? 1 : 0);
  }, [pathLen, progress, reduceMotion]);

  useEffect(() => {
    if (!layout || !pathLen || reduceMotion) return;

    let cancelled = false;

    const run = async () => {
      while (!cancelled) {
        for (let i = 0; i < CHECKPOINTS.length; i++) {
          if (cancelled) return;
          await animate(progress, CHECKPOINTS[i].progress, {
            duration: BURST_DURATION,
            ease: EASE_OUT,
          });
          if (cancelled) return;
          setActiveCheckpoint(CHECKPOINTS[i].id);
          await sleep(EXPAND_MS);
          if (cancelled) return;
          setActiveCheckpoint(null);
          await sleep(COLLAPSE_LAYOUT_MS);
        }
        if (cancelled) return;
        await animate(progress, 1, {
          duration: BURST_DURATION,
          ease: EASE_OUT,
        });
        if (cancelled) return;
        const endpointIsAccount = planLoaded && isPro;
        if (!endpointIsAccount && typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent(GET_PRO_GLOW_EVENT, {
              detail: { ms: GET_PRO_GLOW_MS },
            }),
          );
        }
        await sleep(endpointIsAccount ? 280 : GET_PRO_GLOW_MS);
        if (cancelled) return;
        await animate(progress, 0, { duration: 0.45, ease: "easeInOut" });
        if (cancelled) return;
        await sleep(400);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [pathLen, reduceMotion, isPro, planLoaded]);

  useEffect(() => {
    if (!reduceMotion || !pathLen) return;
    setActiveCheckpoint(CHECKPOINTS[0].id);
    let i = 0;
    const id = window.setInterval(() => {
      const prev = i;
      i = (i + 1) % CHECKPOINTS.length;
      if (prev === CHECKPOINTS.length - 1 && !(planLoaded && isPro)) {
        window.dispatchEvent(
          new CustomEvent(GET_PRO_GLOW_EVENT, {
            detail: { ms: GET_PRO_GLOW_MS },
          }),
        );
      }
      setActiveCheckpoint(CHECKPOINTS[i].id);
    }, EXPAND_MS);
    return () => window.clearInterval(id);
  }, [reduceMotion, pathLen, isPro, planLoaded]);

  const dashOffsetAnimated = useTransform(
    progress,
    (p) => pathLen * (1 - p),
  );

  if (!layout || !pathD) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[75] hidden overflow-visible lg:block"
      aria-hidden
    >
      <svg
        className="absolute left-0 overflow-visible"
        style={{
          top: 0,
          width: layout.width,
          height: HEADER_H,
        }}
        width={layout.width}
        height={HEADER_H}
        viewBox={`0 0 ${layout.width} ${HEADER_H}`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#FF7A59" />
            <stop offset="100%" stopColor="#34D399" />
          </linearGradient>
        </defs>

        <path
          ref={pathRef}
          d={pathD}
          fill="none"
          stroke="rgba(0,0,0,0.08)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {pathLen > 0 && (
          <motion.path
            d={pathD}
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            strokeDasharray={pathLen}
            style={{
              strokeDashoffset: reduceMotion ? 0 : dashOffsetAnimated,
              filter: "drop-shadow(0 0 6px rgba(255,120,80,0.3))",
            }}
          />
        )}
      </svg>

      {CHECKPOINTS.map((cp, i) => {
        const pt = checkpointPoints[i];
        if (!pt) return null;
        const isActive = activeCheckpoint === cp.id;

        return (
          <div
            key={cp.id}
            className="absolute flex items-center justify-center"
            style={{
              left: pt.x,
              top: pt.y + (cp.offsetYPx ?? 0),
              transform: "translate(-50%, -50%)",
            }}
          >
            <LayoutGroup id={`hw-cp-${cp.id}-${uid}`}>
              <motion.div
                layout
                transition={LAYOUT_TRANSITION}
                className="inline-flex max-w-[min(320px,42vw)] origin-center justify-center"
              >
                {isActive ? (
                  <motion.div
                    key="expanded"
                    layout
                    initial={
                      reduceMotion
                        ? false
                        : { scale: 0.95, opacity: 0 }
                    }
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.22, ease: EASE_OUT }}
                    className="max-h-[56px] w-full overflow-hidden rounded-xl border border-ink/12 bg-white/95 px-3 py-2 shadow-[0_4px_16px_rgba(0,0,0,0.1)] backdrop-blur-md"
                  >
                    <p className="text-[11px] font-semibold leading-tight text-ink sm:whitespace-nowrap">
                      {cp.demoTitle}
                    </p>
                    <p className="mt-0.5 text-[10px] leading-tight text-ink/60">
                      {cp.demoSubtitle}
                    </p>
                  </motion.div>
                ) : (
                  <motion.div
                    key="pill"
                    layout
                    className="whitespace-nowrap rounded-full border border-ink/12 bg-surface/75 px-3 py-1 text-[11px] font-medium text-ink/70"
                  >
                    {cp.label}
                  </motion.div>
                )}
              </motion.div>
            </LayoutGroup>
          </div>
        );
      })}
    </div>
  );
}
