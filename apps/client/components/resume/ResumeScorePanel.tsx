"use client";

import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { JobItem } from "../../lib/api";
import { trackResumeMatchUpgradeClick } from "../../lib/analytics/resumeMatchFunnel";
import {
  isResumeMatchInsufficient,
  isResumeMatchInsufficientEvidence,
  isResumeMatchUnscorable,
  resumeFitConfidenceLine,
  resumeGradeLabel,
  resumeLowConfidenceEstimateLabel,
  resumeMatchInsufficientBody,
  resumeMatchInsufficientEvidenceBody,
  resumeMatchInsufficientEvidenceTitle,
  resumeMatchInsufficientHint,
  resumeMatchInsufficientPanelNote,
  resumeMatchInsufficientTitle,
  shouldEmphasizeConfidenceOverScore,
} from "../../lib/resumeGradeLabel";
import type { ScoringResult, KeywordResult } from "../../lib/resumeScorer";
import { ResumeBodyPortal } from "./ResumeBodyPortal";

function UnscorableHeader() {
  return (
    <motion.div
      initial={{ scale: 0.92, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="mx-auto flex h-[120px] w-[120px] shrink-0 items-center justify-center rounded-full border-[10px] border-ink/10 bg-ink/[0.03]"
      aria-hidden
    >
      <span className="text-3xl leading-none">?</span>
    </motion.div>
  );
}

function ScoreCircle({ score }: { score: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - score / 100);

  return (
    <svg width="120" height="120" viewBox="0 0 120 120" className="mx-auto shrink-0">
      <circle
        cx="60"
        cy="60"
        r={r}
        fill="none"
        className="stroke-ink/10"
        strokeWidth="10"
      />
      <motion.circle
        cx="60"
        cy="60"
        r={r}
        fill="none"
        className="stroke-brand"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 0.9, ease: "easeOut" }}
        transform="rotate(-90 60 60)"
      />
      <text
        x="60"
        y="60"
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-ink text-2xl font-extrabold tabular-nums"
      >
        {score}%
      </text>
    </svg>
  );
}

function WorkingChip({
  children,
  title,
  variant,
}: {
  children: ReactNode;
  title?: string;
  variant: "matched" | "partial";
}) {
  const cls =
    variant === "matched"
      ? "border-emerald-300/90 bg-emerald-50 text-ink dark:border-emerald-600/60 dark:bg-emerald-950/55 dark:text-zinc-100"
      : "border-amber-300/90 bg-amber-50 text-ink dark:border-amber-600/55 dark:bg-amber-950/50 dark:text-zinc-100";
  return (
    <span
      title={title}
      className={`inline-flex max-w-full min-w-0 truncate rounded-full border px-2.5 py-1 text-xs font-semibold ${cls}`}
    >
      {children}
    </span>
  );
}

function GapChip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex max-w-full min-w-0 truncate rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-ink ring-1 ring-red-500/20"
    >
      {children}
    </span>
  );
}

export function ResumeScorePanel({
  open,
  onClose,
  job,
  result,
  breakdownAllowed,
  onReuploadResume,
}: {
  open: boolean;
  onClose: () => void;
  job: JobItem;
  result: ScoringResult | null;
  /** Pro (or entitled): full keyword-level breakdown and gap copy. */
  breakdownAllowed: boolean;
  onReuploadResume: () => void;
}) {
  const [toast, setToast] = useState<string | null>(null);
  const [toastMounted, setToastMounted] = useState(false);

  useEffect(() => {
    setToastMounted(true);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const workingItems = useMemo(() => {
    if (!result) return { matched: [] as KeywordResult[], partial: [] as KeywordResult[] };
    return {
      matched: result.matched,
      partial: result.partial,
    };
  }, [result]);

  const insufficient = result ? isResumeMatchInsufficient(result) : false;
  const insufficientEvidence = result ? isResumeMatchInsufficientEvidence(result) : false;
  const unscorable = result ? isResumeMatchUnscorable(result) : false;
  const emphasizeConfidence = result ? shouldEmphasizeConfidenceOverScore(result) : false;
  const missingCount = result?.missing.length ?? 0;
  const workingCount =
    (result?.matched.length ?? 0) + (result?.partial.length ?? 0);

  const copyMissing = useCallback(async () => {
    if (!result || !breakdownAllowed) return;
    const lines: string[] = [];
    lines.push(`Missing keywords for ${job.title} at ${job.company.name}:`);
    lines.push("");
    lines.push("Gaps to address:");
    for (const k of result.missing) {
      lines.push(`• ${k.keyword} — try: "${k.suggestion ?? ""}"`);
    }
    const text = lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setToast("Copied!");
    } catch {
      setToast("Could not copy");
    }
  }, [breakdownAllowed, job.company.name, job.title, result]);

  const toastNode =
    toast && toastMounted && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed bottom-6 left-1/2 z-[230] -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-white shadow-lg">
            {toast}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <ResumeBodyPortal>
        <AnimatePresence>
          {open ? (
            <>
              <motion.button
                key="resume-score-overlay"
                type="button"
                aria-label="Close"
                className="fixed inset-0 z-[200] bg-black/40"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
              />
              <motion.aside
                key="resume-score-drawer"
                className="fixed right-0 top-0 z-[210] flex h-screen w-[min(480px,100vw)] flex-col overflow-hidden border-l border-ink/10 bg-surface shadow-2xl"
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ type: "spring", damping: 25 }}
              >
                <div className="shrink-0 border-b border-ink/10 px-4 pb-5 pt-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg border border-ink/15 px-2 py-1 text-sm font-semibold text-ink hover:bg-ink/5"
                  >
                    ✕
                  </button>
                  <div className="mx-auto mt-3 flex w-full max-w-[300px] flex-col items-center text-center">
                    {result ? (
                      unscorable ? (
                        <UnscorableHeader />
                      ) : result.score !== null ? (
                        emphasizeConfidence ? (
                          <div className="flex flex-col items-center gap-2">
                            <p className="text-sm font-bold text-amber-800 dark:text-amber-200">
                              {resumeLowConfidenceEstimateLabel()}
                            </p>
                            {result.confidenceLevel ? (
                              <p className="max-w-full px-1 text-xs font-semibold leading-relaxed text-ink">
                                {resumeFitConfidenceLine(result.confidenceLevel, result.fitTier)}
                              </p>
                            ) : null}
                            <ScoreCircle score={result.score} />
                          </div>
                        ) : (
                          <ScoreCircle score={result.score} />
                        )
                      ) : null
                    ) : null}
                    <p
                      className={
                        emphasizeConfidence
                          ? "mt-2 text-sm font-medium text-ink-muted"
                          : "mt-2 text-base font-semibold text-ink"
                      }
                    >
                      {result
                        ? insufficient
                          ? resumeMatchInsufficientTitle()
                          : insufficientEvidence
                            ? resumeMatchInsufficientEvidenceTitle()
                            : emphasizeConfidence
                              ? `Fit score: ${result.score}%`
                              : resumeGradeLabel(result.grade)
                        : "—"}
                    </p>
                    <p className="mt-0.5 line-clamp-2 px-2 text-xs leading-snug text-ink-muted">
                      {job.title} · {job.company.name}
                    </p>
                    {result && !unscorable && !emphasizeConfidence && result.confidenceLevel ? (
                      <p className="mt-2 max-w-full px-1 text-[11px] leading-relaxed text-ink-muted">
                        {resumeFitConfidenceLine(result.confidenceLevel, result.fitTier)}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
                  {result && insufficient ? (
                    <section className="flex flex-col gap-3 rounded-xl border border-ink/10 bg-ink/[0.03] p-4">
                      <p className="text-sm leading-relaxed text-ink-muted">
                        {resumeMatchInsufficientBody(result.unavailableReason)}
                      </p>
                      <p className="text-sm text-ink-muted">{resumeMatchInsufficientPanelNote()}</p>
                      <p className="text-xs font-medium text-ink/70">{resumeMatchInsufficientHint()}</p>
                    </section>
                  ) : null}
                  {result && insufficientEvidence ? (
                    <section className="flex flex-col gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-4">
                      <p className="text-sm leading-relaxed text-ink-muted">
                        {resumeMatchInsufficientEvidenceBody()}
                      </p>
                      <p className="text-xs font-medium text-ink/70">
                        {result.signalCount ?? 0} signal{(result.signalCount ?? 0) === 1 ? "" : "s"} detected — a
                        percentage would be misleading here.
                      </p>
                    </section>
                  ) : null}
                  {result && !unscorable ? (
                    <>
                      <section className="relative flex flex-col gap-3">
                        <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold leading-snug text-ink">
                          <span className="inline-flex items-center gap-2">
                            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                            What&apos;s working
                          </span>
                          <span className="font-semibold text-ink-muted">({workingCount} matched)</span>
                        </h3>
                        {breakdownAllowed ? (
                          <div className="flex flex-wrap gap-1.5">
                            {workingItems.matched.map((k) => (
                              <WorkingChip
                                key={`m-${k.keyword}`}
                                variant="matched"
                                title={k.foundIn ? `Found in: ${k.foundIn}` : undefined}
                              >
                                {k.keyword}
                              </WorkingChip>
                            ))}
                            {workingItems.partial.map((k) => (
                              <WorkingChip
                                key={`p-${k.keyword}`}
                                variant="partial"
                                title={k.closestBullet ? `~ ${k.closestBullet}` : undefined}
                              >
                                {k.keyword}≈
                              </WorkingChip>
                            ))}
                            {workingItems.matched.length === 0 &&
                            workingItems.partial.length === 0 ? (
                              <p className="text-sm text-ink-muted">No matches yet — keep tailoring.</p>
                            ) : null}
                          </div>
                        ) : (
                          <div className="relative overflow-hidden rounded-xl border border-ink/10 bg-ink/[0.02] p-4">
                            <div className="pointer-events-none select-none blur-sm" aria-hidden>
                              <div className="flex flex-wrap gap-1.5 opacity-60">
                                {workingItems.matched.slice(0, 6).map((k) => (
                                  <WorkingChip key={`blur-m-${k.keyword}`} variant="matched" title="">
                                    {k.keyword}
                                  </WorkingChip>
                                ))}
                              </div>
                            </div>
                            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-surface via-surface/70 to-transparent" />
                            <div className="relative z-10 flex flex-col gap-2 pt-2">
                              <p className="text-sm font-semibold text-ink">Keyword-level fit is a Pro feature</p>
                              <p className="text-sm text-ink-muted">
                                Your overall score uses the same AI signals. Upgrade to see matched skills, partial
                                matches, and line-level context.
                              </p>
                              <Link
                                href="/pricing"
                                onClick={() =>
                                  trackResumeMatchUpgradeClick({
                                    surface: "resume_score_panel_working",
                                    jobId: job.id,
                                  })
                                }
                                className="pointer-events-auto inline-flex w-fit items-center rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white no-underline hover:bg-brand-hover"
                              >
                                Upgrade to Pro →
                              </Link>
                            </div>
                          </div>
                        )}
                      </section>

                      <section className="flex flex-col gap-3 rounded-xl border border-red-500/15 bg-red-500/[0.06] p-4">
                        <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold leading-snug text-ink">
                          <span className="inline-flex items-center gap-2">
                            <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" aria-hidden />
                            Gaps to address
                          </span>
                          <span className="font-semibold text-ink">({missingCount} missing)</span>
                        </h3>
                        {breakdownAllowed ? (
                          <div className="flex flex-wrap gap-1.5">
                            {result.missing.map((k) => (
                              <GapChip
                                key={k.keyword}
                                title={k.suggestion ? `Try: ${k.suggestion}` : undefined}
                              >
                                {k.keyword}
                              </GapChip>
                            ))}
                          </div>
                        ) : (
                          <div className="flex flex-col gap-3">
                            <p className="text-sm font-semibold text-ink">
                              {missingCount} {missingCount === 1 ? "gap" : "gaps"} detected
                            </p>
                            <p className="text-sm leading-relaxed text-ink-muted">
                              Detailed gap analysis and AI-tailored recommendations are included with Pro.
                            </p>
                            <Link
                              href="/pricing"
                              onClick={() =>
                                trackResumeMatchUpgradeClick({
                                  surface: "resume_score_panel_gaps",
                                  jobId: job.id,
                                })
                              }
                              className="inline-flex w-fit items-center rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white no-underline hover:bg-brand-hover"
                            >
                              Upgrade to Pro →
                            </Link>
                          </div>
                        )}
                      </section>
                    </>
                  ) : null}
                </div>

                <div className="shrink-0 border-t border-ink/10 px-5 py-4">
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:gap-3">
                    {breakdownAllowed && result && !unscorable && result.missing.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => void copyMissing()}
                        className="min-w-0 flex-1 rounded-xl border border-ink/15 bg-white py-3 text-center text-sm font-semibold text-ink transition-colors hover:bg-ink/5 dark:bg-surface"
                      >
                        📋 Copy missing keywords
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={onReuploadResume}
                      className="min-w-0 flex-1 rounded-xl border border-brand/30 bg-brand/10 py-3 text-sm font-semibold text-brand hover:bg-brand/15"
                    >
                      📤 Re-upload resume
                    </button>
                  </div>
                </div>
              </motion.aside>
            </>
          ) : null}
        </AnimatePresence>
      </ResumeBodyPortal>
      {toastNode}
    </>
  );
}
