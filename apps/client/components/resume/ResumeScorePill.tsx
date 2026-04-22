"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { JobItem } from "../../lib/api";
import { fetchResumeSemanticMatch } from "../../lib/api";
import {
  extractJobKeywords,
  isResumeLegacyKeywordMode,
  scoreResume,
  type ScoringResult,
} from "../../lib/resumeScorer";
import { extractJobSkills, jobSkillCanonicalsForSemantic } from "../../lib/skillExtractor";
import { useResume } from "../../lib/resumeContext";
import { useAccountPlan } from "../../lib/useAccountPlan";
import { cn } from "../../lib/cn";
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
  const { isPro, isLoaded: planLoaded } = useAccountPlan();
  const { hasResume, resumeText, resumeBullets, isLoading } = useResume();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [result, setResult] = useState<ScoringResult | null>(null);

  useEffect(() => {
    setResult(null);
    setPanelOpen(false);
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

    let semantic: Record<string, { bullet: string; similarity: number }> = {};
    if (keywordStrings.length && bullets.length) {
      try {
        semantic = await fetchResumeSemanticMatch(token, {
          keywords: keywordStrings,
          bullets,
        });
      } catch {
        semantic = {};
      }
    }

    const scored = scoreResume(text, bullets, job, semantic);
    setResult(scored);
  }, [getToken, job, resumeBullets, resumeText]);

  const onCheckClick = useCallback(async () => {
    if (!hasResume) {
      setUploadOpen(true);
      return;
    }
    setScoring(true);
    try {
      await runScore();
    } finally {
      setScoring(false);
    }
  }, [hasResume, runScore]);

  if (!isSignedIn) {
    return null;
  }

  if (!planLoaded) {
    return (
      <div className="h-9 w-full min-w-[10rem] shrink-0 animate-pulse rounded-lg bg-ink/10" aria-hidden />
    );
  }

  if (!isPro) {
    return (
      <Link
        href="/pricing"
        className={cn(
          buttonFocusRing,
          "relative flex h-9 w-full min-w-0 items-center justify-center rounded-lg border-2 border-brand/35 bg-brand/10 px-3 text-xs font-bold tracking-wide text-brand no-underline transition-[transform,box-shadow] duration-200 hover:bg-brand/15",
        )}
      >
        <span aria-hidden className="absolute left-3 shrink-0 text-sm leading-none">
          📄
        </span>
        <span className="text-center">Pro: resume match</span>
      </Link>
    );
  }

  if (isLoading) {
    return (
      <div className="h-9 w-full min-w-[10rem] shrink-0 animate-pulse rounded-lg bg-ink/10" aria-hidden />
    );
  }

  const showScoredPill = Boolean(result) && !scoring;
  const scored = result;
  const c = scored ? pillColors(scored.score) : null;

  return (
    <>
      {showScoredPill && c && scored ? (
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
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
          <span
            className="h-4 w-px shrink-0 bg-current opacity-25"
            aria-hidden
          />
          <span className="shrink-0 text-[11px] font-medium opacity-75">See full breakdown →</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void onCheckClick()}
          disabled={scoring}
          className={cn(
            buttonFocusRing,
            "relative flex h-9 w-full min-w-0 items-center rounded-lg border-2 border-ink/12 bg-transparent px-3 text-xs font-bold tracking-wide text-ink/65",
            "transition-[transform,box-shadow,border-color,background-color,color] duration-200 ease-out",
            "hover:-translate-y-px hover:border-brand/45 hover:bg-brand/[0.07] hover:text-ink hover:shadow-md hover:shadow-black/[0.08]",
            "active:translate-y-0 active:shadow-sm active:shadow-black/[0.04]",
            "disabled:pointer-events-none disabled:opacity-50",
            "dark:border-white/14 dark:text-ink/75",
            "dark:hover:border-brand/50 dark:hover:bg-brand/[0.12] dark:hover:shadow-black/35",
          )}
        >
          {scoring ? (
            <span className="mx-auto h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-ink/20 border-t-brand" />
          ) : (
            <>
              <span aria-hidden className="absolute left-3 shrink-0 text-sm leading-none">
                📄
              </span>
              <span className="w-full text-center">Check match</span>
            </>
          )}
        </button>
      )}

      <ResumeUploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <ResumeScorePanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        job={job}
        result={result}
        onReuploadResume={() => {
          setPanelOpen(false);
          setUploadOpen(true);
        }}
      />
    </>
  );
}
