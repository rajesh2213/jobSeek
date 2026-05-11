"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { JobItem } from "../../lib/api";
import { ApiRequestError, fetchResumeSemanticMatch, type ResumeSemanticMatchMeta } from "../../lib/api";
import {
  trackResumeFirstMatchViewedOnce,
  trackResumeMatchQuotaHit,
  trackResumeMatchUpgradeClick,
} from "../../lib/analytics/resumeMatchFunnel";
import {
  extractJobKeywords,
  isResumeLegacyKeywordMode,
  scoreResume,
  type ScoringResult,
} from "../../lib/resumeScorer";
import { extractJobSkills, jobSkillCanonicalsForSemantic } from "../../lib/skillExtractor";
import { useResume } from "../../lib/resumeContext";
import { useAccountPlan } from "../../lib/useAccountPlan";
import { formatUserLocalResetForMessage } from "../../lib/userLocalResetTime";
import { cn } from "../../lib/cn";
import { signInWithNext } from "../../lib/signInUrl";
import { buttonFocusRing } from "../ui/Button";
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
  const [quotaBlocked, setQuotaBlocked] = useState(false);
  const returnPath = `${pathname}${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`;
  const signInHref = signInWithNext(returnPath || "/jobs");

  useEffect(() => {
    setResult(null);
    setPanelOpen(false);
    setMatchMeta(null);
    setQuotaBlocked(false);
  }, [job.id]);

  useEffect(() => {
    if (!hasResume) setResult(null);
  }, [hasResume]);

  const runScore = useCallback(async () => {
    const text = resumeText ?? "";
    const bullets = resumeBullets;
    const keywordStrings = isResumeLegacyKeywordMode()
      ? extractJobKeywords(job).map((k) => k.keyword)
      : jobSkillCanonicalsForSemantic(extractJobSkills(job));
    const token = await getToken();
    if (!token) return;

    if (!isPro && resumeMatchAi && resumeMatchAi.remaining <= 0) {
      setQuotaBlocked(true);
      trackResumeMatchQuotaHit({ remaining: 0, jobId: job.id });
      return;
    }

    let semantic: Record<string, { bullet: string; similarity: number }> = {};
    let meta: ResumeSemanticMatchMeta | null = null;
    if (keywordStrings.length && bullets.length) {
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
          setQuotaBlocked(true);
          trackResumeMatchQuotaHit({ remaining: 0, jobId: job.id });
          void refresh();
        }
        semantic = {};
        setMatchMeta(null);
      }
    }

    const scored = scoreResume(text, bullets, job, semantic);
    setResult(scored);
    if (meta && scored.score > 0) {
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
    setQuotaBlocked(false);
    setScoring(true);
    try {
      await runScore();
    } finally {
      setScoring(false);
    }
  }, [hasResume, isLoading, isSignedIn, planLoaded, router, runScore, signInHref]);

  const breakdownAllowed = matchMeta?.breakdownAllowed ?? isPro;
  const showScoredPill = Boolean(result) && !scoring && isSignedIn && planLoaded && !isLoading;
  const scored = result;
  const c = scored ? pillColors(scored.score) : null;
  const loadingState = isSignedIn && (!planLoaded || isLoading);
  const actionDisabled = scoring || loadingState;

  const quotaHint =
    isSignedIn && !isPro && resumeMatchAi && resumeMatchAi.remaining >= 0
      ? resumeMatchAi.remaining === 0
        ? `Limit reached · ${formatUserLocalResetForMessage(resumeMatchAi.resetAt)}`
        : `${resumeMatchAi.remaining} free AI match${resumeMatchAi.remaining === 1 ? "" : "es"} left`
      : null;

  const onPillOpen = () => {
    if (!breakdownAllowed) {
      trackResumeMatchUpgradeClick({ surface: "resume_score_pill_drawer", jobId: job.id });
    }
    setPanelOpen(true);
  };

  return (
    <>
      {quotaBlocked ? (
        <div className="w-full rounded-lg border border-brand/25 bg-brand/5 px-3 py-2 text-center text-[11px] font-semibold leading-snug text-brand">
          <span className="block">Free AI matches used</span>
          <Link
            href="/pricing"
            onClick={() => trackResumeMatchUpgradeClick({ surface: "resume_score_pill_quota", jobId: job.id })}
            className="mt-1 inline-block text-[11px] font-bold text-brand underline"
          >
            Upgrade for unlimited →
          </Link>
        </div>
      ) : showScoredPill && c && scored ? (
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
            <span className="min-w-0 truncate">{scored.score}% match</span>
          </span>
          <span className="h-4 w-px shrink-0 bg-current opacity-25" aria-hidden />
          <span className="shrink-0 text-[11px] font-medium opacity-75">
            {breakdownAllowed ? "See full breakdown →" : "Details (Pro) →"}
          </span>
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
                <span className="w-full text-center">{loadingState ? "Loading match…" : "Check match"}</span>
              </>
            )}
          </button>
          {quotaHint ? (
            <p className="mt-1 text-center text-[10px] font-medium leading-tight text-ink-muted">{quotaHint}</p>
          ) : null}
        </div>
      )}

      <ResumeUploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
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
    </>
  );
}
