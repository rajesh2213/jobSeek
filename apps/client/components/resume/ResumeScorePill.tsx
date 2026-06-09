"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { JobItem } from "../../lib/api";
import { ApiRequestError, fetchResumeSemanticMatch, type ResumeSemanticMatchMeta } from "../../lib/api";
import {
  trackResumeFirstMatchViewedOnce,
  trackResumeFitConfidence,
  trackResumeFitUnavailable,
  trackResumeFitViewed,
  trackResumeMatchQuotaHit,
  trackResumeMatchUpgradeClick,
} from "../../lib/analytics/resumeMatchFunnel";
import {
  extractJobKeywords,
  isResumeLegacyKeywordMode,
  isResumeMatchInsufficientEvidence,
  isResumeMatchScored,
  jobHasMatchSignals,
  jobMatchSignalsForSemantic,
  scoreResume,
  type ScoringResult,
} from "../../lib/resumeScorer";
import { useResume } from "../../lib/resumeContext";
import { useAccountPlan } from "../../lib/useAccountPlan";
import { formatUserLocalResetForMessage } from "../../lib/userLocalResetTime";
import { cn } from "../../lib/cn";
import { signInWithNext } from "../../lib/signInUrl";
import { buttonFocusRing } from "../ui/Button";
import { logResumeFitHydrate, resolveJobForFitScoring } from "../../lib/resumeFitHydrate";
import { ResumeScorePanel } from "./ResumeScorePanel";
import { ResumeUploadModal } from "./ResumeUploadModal";

function pillColors(score: number): { bg: string; fg: string; border: string } {
  if (score >= 75) {
    return { bg: "#f0fdf4", fg: "#15803d", border: "#bbf7d0" };
  }
  if (score >= 55) {
    return { bg: "#fffbeb", fg: "#b45309", border: "#fde68a" };
  }
  return { bg: "#fff7ed", fg: "#c2410c", border: "#fed7aa" };
}

function unscorablePillColors(): { bg: string; fg: string; border: string } {
  return { bg: "#f8fafc", fg: "#475569", border: "#e2e8f0" };
}

export function ResumeScorePill({ job }: { job: JobItem }) {
  const { isSignedIn, getToken } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isPro, isLoaded: planLoaded, resumeMatchAi, refresh } = useAccountPlan();
  const { hasResume, resumeText, resumeBullets, isLoading } = useResume();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [result, setResult] = useState<ScoringResult | null>(null);
  const [matchMeta, setMatchMeta] = useState<ResumeSemanticMatchMeta | null>(null);
  const [semanticUnavailable, setSemanticUnavailable] = useState(false);
  const [scoringJob, setScoringJob] = useState<JobItem>(job);
  const returnPath = `${pathname}${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`;
  const signInHref = signInWithNext(returnPath || "/jobs");

  useEffect(() => {
    setScoringJob(job);
    setResult(null);
    setPanelOpen(false);
    setMatchMeta(null);
    setSemanticUnavailable(false);
  }, [job]);

  useEffect(() => {
    if (!hasResume) setResult(null);
  }, [hasResume]);

  const runScore = useCallback(async () => {
    const text = resumeText ?? "";
    const bullets = resumeBullets;
    const token = await getToken();
    if (!token) return;

    const scoreT0 = performance.now();
    const { job: fitJob, hydrated, fetchMs } = await resolveJobForFitScoring(job, getToken);
    setScoringJob(fitJob);

    const keywordStrings = isResumeLegacyKeywordMode()
      ? extractJobKeywords(fitJob).map((k) => k.keyword)
      : jobMatchSignalsForSemantic(fitJob);

    const canTrySemantic =
      isPro || !resumeMatchAi || resumeMatchAi.remaining > 0;

    let semantic: Record<string, { bullet: string; similarity: number }> = {};
    let meta: ResumeSemanticMatchMeta | null = null;
    let skippedSemantic = false;

    if (
      jobHasMatchSignals(fitJob) &&
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
      jobHasMatchSignals(fitJob) &&
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

    const scored = scoreResume(text, bullets, fitJob, semantic);
    setResult(scored);

    const scoreMs = Math.round(performance.now() - scoreT0);
    logResumeFitHydrate({
      jobId: job.id,
      fetchMs,
      scoreMs,
      confidence: scored.confidenceLevel ?? null,
      hydrated,
    });

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

  const onCheckClick = useCallback(async () => {
    if (!isSignedIn) {
      router.push(signInHref);
      return;
    }
    if (!planLoaded || isLoading) {
      return;
    }
    if (!hasResume) {
      setUploadOpen(true);
      return;
    }
    setSemanticUnavailable(false);
    setScoring(true);
    try {
      await runScore();
    } finally {
      setScoring(false);
    }
  }, [hasResume, isLoading, isSignedIn, planLoaded, router, runScore, signInHref]);

  const breakdownAllowed = matchMeta?.breakdownAllowed ?? isPro;
  const showResultPill = Boolean(result) && !scoring && isSignedIn && planLoaded && !isLoading;
  const scored = result;
  const isScored = scored ? isResumeMatchScored(scored) : false;
  const isInsufficientEvidence = scored ? isResumeMatchInsufficientEvidence(scored) : false;
  const isUnscorable = scored ? !isResumeMatchScored(scored) : false;
  const emphasizeLowConfidence =
    isScored && scored?.fitTier !== null && (scored.fitTier === 3 || scored.fitTier === 4);
  const c =
    scored && isScored && scored.score !== null
      ? pillColors(scored.score)
      : isUnscorable
        ? unscorablePillColors()
        : null;
  const loadingState = isSignedIn && (!planLoaded || isLoading);
  const actionDisabled = scoring || loadingState;

  const quotaHint =
    isSignedIn && !isPro && resumeMatchAi && resumeMatchAi.remaining >= 0
      ? resumeMatchAi.remaining === 0
        ? `AI enhancement unavailable · ${formatUserLocalResetForMessage(resumeMatchAi.resetAt)}`
        : `${resumeMatchAi.remaining} free AI enhancement${resumeMatchAi.remaining === 1 ? "" : "s"} left`
      : null;

  const onPillOpen = () => {
    if (!breakdownAllowed) {
      trackResumeMatchUpgradeClick({ surface: "resume_score_pill_drawer", jobId: job.id });
    }
    setPanelOpen(true);
  };

  return (
    <>
      {showResultPill && c && scored && isScored && scored.score !== null ? (
        <div className="w-full">
          <button
            type="button"
            onClick={() => onPillOpen()}
            className="flex h-9 w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-3 text-left text-[13px] font-semibold leading-none shadow-sm transition-shadow duration-200 ease-out hover:shadow-md hover:shadow-black/[0.07] active:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/45 focus-visible:ring-offset-2 dark:hover:shadow-black/35"
            style={{
              background: c.bg,
              color: c.fg,
              borderColor: c.border,
            }}
          >
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <span aria-hidden className="shrink-0">
                ●
              </span>
              <span className="min-w-0 truncate">
                {emphasizeLowConfidence
                  ? `Low-confidence estimate · ${scored.score}%`
                  : `Fit score: ${scored.score}%`}
              </span>
            </span>
            <span className="h-4 w-px shrink-0 bg-current opacity-25" aria-hidden />
            <span className="shrink-0 text-[11px] font-medium opacity-75">
              {breakdownAllowed ? "See full breakdown →" : "Details (Pro) →"}
            </span>
          </button>
          {semanticUnavailable ? (
            <p className="mt-1 text-center text-[10px] font-medium leading-tight text-brand">
              AI enhancement unavailable —{" "}
              <Link
                href="/pricing"
                onClick={() =>
                  trackResumeMatchUpgradeClick({ surface: "resume_score_pill_semantic", jobId: job.id })
                }
                className="font-bold underline"
              >
                Upgrade for semantic matching
              </Link>
            </p>
          ) : quotaHint ? (
            <p className="mt-1 text-center text-[10px] font-medium leading-tight text-ink-muted">{quotaHint}</p>
          ) : null}
        </div>
      ) : showResultPill && c && scored && isUnscorable ? (
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          className="flex h-9 w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-3 text-left text-[13px] font-semibold leading-none shadow-sm transition-shadow duration-200 ease-out hover:shadow-md hover:shadow-black/[0.07] active:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25 focus-visible:ring-offset-2 dark:hover:shadow-black/35"
          style={{
            background: c.bg,
            color: c.fg,
            borderColor: c.border,
          }}
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span aria-hidden className="shrink-0">
              ○
            </span>
            <span className="min-w-0 truncate">
              {isInsufficientEvidence
                ? "Insufficient evidence for a reliable fit estimate"
                : "Fit estimate unavailable"}
            </span>
          </span>
          <span className="h-4 w-px shrink-0 bg-current opacity-25" aria-hidden />
          <span className="shrink-0 text-[11px] font-medium opacity-75">Details →</span>
        </button>
      ) : (
        <div className="w-full">
          <button
            type="button"
            onClick={() => void onCheckClick()}
            disabled={scoring || loadingState}
            className={cn(
              buttonFocusRing,
              "relative flex h-9 w-full min-w-0 items-center rounded-lg border-2 border-ink/12 bg-transparent px-3 text-xs font-bold tracking-wide text-ink/65",
              "transition-[transform,box-shadow,border-color,background-color,color] duration-200 ease-out",
              !actionDisabled &&
                "hover:-translate-y-px hover:border-brand/45 hover:bg-brand/[0.07] hover:text-ink hover:shadow-md hover:shadow-black/[0.08]",
              !actionDisabled && "active:translate-y-0 active:shadow-sm active:shadow-black/[0.04]",
              (scoring || loadingState) && "opacity-60",
              "dark:border-white/14 dark:text-ink/75",
              !actionDisabled && "dark:hover:border-brand/50 dark:hover:bg-brand/[0.12] dark:hover:shadow-black/35",
            )}
          >
            {scoring ? (
              <span className="mx-auto h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-ink/20 border-t-brand" />
            ) : (
              <>
                <span aria-hidden className="absolute left-3 shrink-0 text-sm leading-none">
                  📄
                </span>
                <span className="w-full text-center">{loadingState ? "Loading fit…" : "Check fit"}</span>
              </>
            )}
          </button>
          {quotaHint && !semanticUnavailable ? (
            <p className="mt-1 text-center text-[10px] font-medium leading-tight text-ink-muted">{quotaHint}</p>
          ) : null}
        </div>
      )}

      <ResumeUploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <ResumeScorePanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        job={scoringJob}
        result={result}
        breakdownAllowed={breakdownAllowed}
        onReuploadResume={() => {
          setPanelOpen(false);
          setUploadOpen(true);
        }}
      />
    </>
  );
}
