"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { JobItem, ResumeMatchAiQuotaState, ResumeSemanticMatchMeta } from "../../lib/api";
import { ApiRequestError, fetchResumeSemanticMatch } from "../../lib/api";
import {
  trackResumeFirstMatchViewedOnce,
  trackResumeFitConfidence,
  trackResumeFitUnavailable,
  trackResumeFitViewed,
  trackResumeMatchQuotaHit,
  trackResumeMatchUpgradeClick,
} from "../../lib/analytics/resumeMatchFunnel";
import {
  isResumeMatchInsufficient,
  isResumeMatchInsufficientEvidence,
  resumeFitConfidenceLine,
  resumeLowConfidenceEstimateLabel,
  resumeMatchInsufficientBody,
  resumeMatchInsufficientEvidenceBody,
  resumeMatchInsufficientEvidenceTitle,
  resumeMatchInsufficientHint,
  resumeMatchInsufficientTitle,
  resumeMatchSubtitle,
  shouldEmphasizeConfidenceOverScore,
} from "../../lib/resumeGradeLabel";
import {
  extractJobKeywords,
  isResumeLegacyKeywordMode,
  isResumeMatchScored,
  jobHasMatchSignals,
  jobMatchSignalsForSemantic,
  scoreResume,
  type ScoringResult,
} from "../../lib/resumeScorer";
import { useResume } from "../../lib/resumeContext";
import { useAccountPlan } from "../../lib/useAccountPlan";
import { formatUserLocalResetForMessage } from "../../lib/userLocalResetTime";
import { ResumeScorePanel } from "./ResumeScorePanel";
import { ResumeUploadModal } from "./ResumeUploadModal";

function MiniRing({ score }: { score: number }) {
  const r = 36;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - score / 100);
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" className="shrink-0">
      <circle cx="44" cy="44" r={r} fill="none" className="stroke-ink/10" strokeWidth="8" />
      <circle
        cx="44"
        cy="44"
        r={r}
        fill="none"
        className="stroke-brand"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform="rotate(-90 44 44)"
      />
      <text
        x="44"
        y="44"
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-ink text-lg font-extrabold tabular-nums"
      >
        {score}%
      </text>
    </svg>
  );
}

function quotaHintLine(
  isPro: boolean,
  meta: ResumeSemanticMatchMeta | null,
  resumeMatchAi: ResumeMatchAiQuotaState | null,
  semanticUnavailable: boolean,
): string | null {
  if (isPro) return null;
  if (semanticUnavailable) {
    const resetAt = meta?.quota?.resetAt ?? resumeMatchAi?.resetAt;
    return resetAt
      ? `AI enhancement unavailable — next slot after ${formatUserLocalResetForMessage(resetAt)}.`
      : "AI enhancement unavailable — upgrade for semantic matching.";
  }
  const q = meta?.quota ?? resumeMatchAi;
  if (!q) return null;
  if (q.remaining <= 0) {
    return `AI enhancement unavailable — next slot after ${formatUserLocalResetForMessage(q.resetAt)}.`;
  }
  return `${q.remaining} free AI enhancement${q.remaining === 1 ? "" : "s"} left in your current window.`;
}

export function ResumeMatchSection({ job }: { job: JobItem }) {
  const { isSignedIn, getToken } = useAuth();
  const { isPro, isLoaded: planLoaded, resumeMatchAi, refresh } = useAccountPlan();
  const { hasResume, resumeText, resumeBullets } = useResume();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScoringResult | null>(null);
  const [matchMeta, setMatchMeta] = useState<ResumeSemanticMatchMeta | null>(null);
  const [semanticUnavailable, setSemanticUnavailable] = useState(false);
  const pendingScoreAfterUploadRef = useRef(false);

  useEffect(() => {
    setResult(null);
    setMatchMeta(null);
    setSemanticUnavailable(false);
  }, [job.id]);

  const runScore = useCallback(async () => {
    const text = resumeText ?? "";
    const bullets = resumeBullets;
    const keywordStrings = isResumeLegacyKeywordMode()
      ? extractJobKeywords(job).map((k) => k.keyword)
      : jobMatchSignalsForSemantic(job);
    const token = await getToken();
    if (!token) return;

    const canTrySemantic =
      isPro || !resumeMatchAi || resumeMatchAi.remaining > 0;

    let semantic: Record<string, { bullet: string; similarity: number }> = {};
    let meta: ResumeSemanticMatchMeta | null = null;
    let skippedSemantic = false;

    if (
      jobHasMatchSignals(job) &&
      keywordStrings.length &&
      bullets.length &&
      canTrySemantic
    ) {
      try {
        const res = await fetchResumeSemanticMatch(token, {
          keywords: keywordStrings,
          bullets,
        });
        semantic = res.matches;
        meta = res.matchMeta;
        setMatchMeta(meta);
        void refresh();
      } catch (e) {
        if (e instanceof ApiRequestError && e.code === "RESUME_MATCH_AI_QUOTA_EXCEEDED") {
          skippedSemantic = true;
          trackResumeMatchQuotaHit({ remaining: 0, jobId: job.id });
          void refresh();
        }
        semantic = {};
        setMatchMeta(null);
      }
    } else if (
      jobHasMatchSignals(job) &&
      keywordStrings.length &&
      bullets.length &&
      !canTrySemantic
    ) {
      skippedSemantic = true;
      trackResumeMatchQuotaHit({ remaining: 0, jobId: job.id });
      setMatchMeta(null);
    } else {
      setMatchMeta(null);
    }

    setSemanticUnavailable(skippedSemantic);

    const scored = scoreResume(text, bullets, job, semantic);
    setResult(scored);

    if (!isResumeMatchScored(scored)) {
      trackResumeFitUnavailable({
        jobId: job.id,
        reason: scored.unavailableReason ?? "insufficient_signals",
      });
      return;
    }

    if (scored.score !== null && scored.confidenceLevel) {
      trackResumeFitViewed({
        jobId: job.id,
        score: scored.score,
        confidence: scored.confidenceLevel,
        fitTier: scored.fitTier ?? null,
      });
      trackResumeFitConfidence({
        jobId: job.id,
        confidence: scored.confidenceLevel,
        signalCount: scored.signalCount ?? 0,
      });
    }

    if (meta && scored.score !== null && scored.score > 0) {
      void trackResumeFirstMatchViewedOnce({
        getToken,
        jobId: job.id,
        planTier: meta.tier,
        score: scored.score,
      });
    }
  }, [getToken, isPro, job, refresh, resumeBullets, resumeMatchAi, resumeText]);

  const onCheck = async () => {
    if (!hasResume) {
      setUploadOpen(true);
      return;
    }
    setBusy(true);
    setSemanticUnavailable(false);
    try {
      await runScore();
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!pendingScoreAfterUploadRef.current) return;
    if (!hasResume || busy) return;
    pendingScoreAfterUploadRef.current = false;
    void onCheck();
  }, [busy, hasResume, onCheck]);

  if (!isSignedIn) {
    return null;
  }

  if (!planLoaded) {
    return (
      <section className="rounded-2xl border border-ink/10 bg-surface/80 p-5 shadow-sm ring-1 ring-ink/5">
        <div className="h-24 animate-pulse rounded-xl bg-ink/10" aria-hidden />
      </section>
    );
  }

  const breakdownAllowed = matchMeta?.breakdownAllowed ?? isPro;
  const hint = quotaHintLine(isPro, matchMeta, resumeMatchAi, semanticUnavailable);

  const openBreakdown = () => {
    if (!breakdownAllowed) {
      trackResumeMatchUpgradeClick({ surface: "resume_match_section_drawer", jobId: job.id });
    }
    setPanelOpen(true);
  };

  return (
    <section className="rounded-2xl border border-ink/10 bg-surface/80 p-5 shadow-sm ring-1 ring-ink/5">
      {!result ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-base font-semibold text-ink">
              <span aria-hidden className="mr-1.5">
                📄
              </span>
              Check your resume fit
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              {isPro
                ? "See how well your profile fits this role."
                : "See your fit score on the free tier — keyword breakdown and semantic matching are Pro features."}
            </p>
            {hint ? <p className="mt-2 text-xs font-semibold text-brand/90">{hint}</p> : null}
          </div>
          <button
            type="button"
            onClick={() => void onCheck()}
            disabled={busy}
            className="shrink-0 rounded-lg border border-[rgba(0,0,0,0.15)] bg-white px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-ink/[0.03] disabled:opacity-60 dark:border-white/20 dark:bg-surface sm:self-center"
          >
            {busy ? "Scoring…" : "Check fit →"}
          </button>
        </div>
      ) : isResumeMatchInsufficient(result) ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-lg font-bold text-ink">{resumeMatchInsufficientTitle()}</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              {resumeMatchInsufficientBody(result.unavailableReason)}
            </p>
            <p className="mt-3 text-xs font-medium text-ink/70">{resumeMatchInsufficientHint()}</p>
          </div>
          <button
            type="button"
            onClick={() => openBreakdown()}
            className="shrink-0 rounded-lg border border-ink/15 bg-white px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-ink/5 dark:bg-surface sm:self-center"
          >
            Learn more →
          </button>
        </div>
      ) : isResumeMatchInsufficientEvidence(result) ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-lg font-bold text-ink">{resumeMatchInsufficientEvidenceTitle()}</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              {resumeMatchInsufficientEvidenceBody()}
            </p>
          </div>
          <button
            type="button"
            onClick={() => openBreakdown()}
            className="shrink-0 rounded-lg border border-ink/15 bg-white px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-ink/5 dark:bg-surface sm:self-center"
          >
            Learn more →
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            {result.score !== null ? <MiniRing score={result.score} /> : null}
            <div className="min-w-0 flex-1">
              {shouldEmphasizeConfidenceOverScore(result) ? (
                <>
                  <p className="text-lg font-bold text-amber-800 dark:text-amber-200">
                    {resumeLowConfidenceEstimateLabel()}
                  </p>
                  {result.confidenceLevel ? (
                    <p className="mt-1 text-sm font-semibold text-ink">
                      {resumeFitConfidenceLine(result.confidenceLevel, result.fitTier)}
                    </p>
                  ) : null}
                  <p className="mt-2 text-sm font-medium text-ink-muted">Fit score: {result.score}%</p>
                </>
              ) : (
                <>
                  <p className="text-lg font-bold text-ink">Fit score: {result.score}%</p>
                  <p className="mt-1 text-sm font-medium text-ink/90">
                    &ldquo;{resumeMatchSubtitle(result.grade)}&rdquo;
                  </p>
                  {result.confidenceLevel ? (
                    <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                      {resumeFitConfidenceLine(result.confidenceLevel, result.fitTier)}
                    </p>
                  ) : null}
                </>
              )}
              {isPro ? (
                <p className="mt-2 text-sm text-ink-muted">
                  {result.matched.length} matched · {result.missing.length} gaps
                </p>
              ) : null}
              {hint ? <p className="mt-2 text-xs font-semibold text-brand/90">{hint}</p> : null}
              {semanticUnavailable && !isPro ? (
                <p className="mt-2 text-xs font-semibold text-brand/90">
                  <Link
                    href="/pricing"
                    onClick={() =>
                      trackResumeMatchUpgradeClick({
                        surface: "resume_match_section_semantic",
                        jobId: job.id,
                      })
                    }
                    className="underline"
                  >
                    Upgrade for semantic matching →
                  </Link>
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
            <button
              type="button"
              onClick={() => openBreakdown()}
              className="w-full flex-1 rounded-lg border border-ink/15 bg-white py-3 text-center text-sm font-semibold text-ink transition-colors hover:bg-ink/5 dark:bg-surface"
            >
              {breakdownAllowed ? "See full breakdown →" : "Preview breakdown (Pro) →"}
            </button>
            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="w-full flex-1 rounded-lg border border-ink/15 bg-white py-3 text-center text-sm font-semibold text-ink transition-colors hover:bg-ink/5 dark:bg-surface"
            >
              Re-upload resume →
            </button>
          </div>
        </div>
      )}

      <ResumeUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploadSuccess={() => {
          pendingScoreAfterUploadRef.current = true;
        }}
      />
      <ResumeScorePanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        job={job}
        result={result}
        breakdownAllowed={breakdownAllowed}
        onReuploadResume={() => {
          setPanelOpen(false);
          setUploadOpen(true);
        }}
      />
    </section>
  );
}
