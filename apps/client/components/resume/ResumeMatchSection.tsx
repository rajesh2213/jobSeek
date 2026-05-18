"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { JobItem, ResumeMatchAiQuotaState, ResumeSemanticMatchMeta } from "../../lib/api";
import { ApiRequestError, fetchResumeSemanticMatch } from "../../lib/api";
import {
  trackResumeFirstMatchViewedOnce,
  trackResumeMatchQuotaHit,
  trackResumeMatchUnscorable,
  trackResumeMatchUpgradeClick,
} from "../../lib/analytics/resumeMatchFunnel";
import {
  isResumeMatchInsufficient,
  resumeMatchInsufficientBody,
  resumeMatchInsufficientHint,
  resumeMatchInsufficientTitle,
  resumeMatchSubtitle,
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
): string | null {
  if (isPro) return null;
  const q = meta?.quota ?? resumeMatchAi;
  if (!q) return null;
  if (q.remaining <= 0) {
    return `Free AI matches used — next slot opens after ${formatUserLocalResetForMessage(q.resetAt)}.`;
  }
  return `${q.remaining} free AI match${q.remaining === 1 ? "" : "es"} left in your current window.`;
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
  const [quotaWall, setQuotaWall] = useState<{ resetAt: string } | null>(null);
  const pendingScoreAfterUploadRef = useRef(false);

  useEffect(() => {
    setResult(null);
    setMatchMeta(null);
    setQuotaWall(null);
  }, [job.id]);

  const runScore = useCallback(async () => {
    const text = resumeText ?? "";
    const bullets = resumeBullets;
    const keywordStrings = isResumeLegacyKeywordMode()
      ? extractJobKeywords(job).map((k) => k.keyword)
      : jobMatchSignalsForSemantic(job);
    const token = await getToken();
    if (!token) return;

    if (!jobHasMatchSignals(job)) {
      const scored = scoreResume(text, bullets, job, {});
      setResult(scored);
      setMatchMeta(null);
      trackResumeMatchUnscorable({ jobId: job.id });
      return;
    }

    if (!isPro && resumeMatchAi && resumeMatchAi.remaining <= 0) {
      setQuotaWall({ resetAt: resumeMatchAi.resetAt });
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
        if (e instanceof ApiRequestError && e.code === "RESUME_MATCH_AI_QUOTA_EXCEEDED" && e.resumeMatchAiQuota) {
          setQuotaWall({ resetAt: e.resumeMatchAiQuota.resetAt });
          trackResumeMatchQuotaHit({ remaining: 0, jobId: job.id });
          void refresh();
        }
        semantic = {};
        setMatchMeta(null);
      }
    }

    const scored = scoreResume(text, bullets, job, semantic);
    setResult(scored);
    if (meta && isResumeMatchScored(scored) && scored.score !== null && scored.score > 0) {
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
    setQuotaWall(null);
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
  const hint = quotaHintLine(isPro, matchMeta, resumeMatchAi);

  const openBreakdown = () => {
    if (!breakdownAllowed) {
      trackResumeMatchUpgradeClick({ surface: "resume_match_section_drawer", jobId: job.id });
    }
    setPanelOpen(true);
  };

  return (
    <section className="rounded-2xl border border-ink/10 bg-surface/80 p-5 shadow-sm ring-1 ring-ink/5">
      {quotaWall ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-base font-semibold text-ink">
              <span aria-hidden className="mr-1.5">
                📄
              </span>
              Free AI match limit reached
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              You have used all free AI resume matches in your current 24-hour window. Upgrade for unlimited matches,
              full gap analysis, and Smart Apply.
            </p>
            <p className="mt-2 text-xs font-medium text-ink/70">
              Next free slot no earlier than {formatUserLocalResetForMessage(quotaWall.resetAt)}.
            </p>
          </div>
          <Link
            href="/pricing"
            onClick={() => trackResumeMatchUpgradeClick({ surface: "resume_match_section_quota_wall", jobId: job.id })}
            className="shrink-0 rounded-lg bg-brand px-4 py-2.5 text-center text-sm font-semibold text-white no-underline transition-colors hover:bg-brand-hover sm:self-center"
          >
            Upgrade to Pro →
          </Link>
        </div>
      ) : !result ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-base font-semibold text-ink">
              <span aria-hidden className="mr-1.5">
                📄
              </span>
              Check your resume match
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              {isPro
                ? "See how well your profile fits this role."
                : "See your AI match score for this role on the free tier — deeper keyword and gap breakdown is Pro-only."}
            </p>
            {hint ? <p className="mt-2 text-xs font-semibold text-brand/90">{hint}</p> : null}
          </div>
          <button
            type="button"
            onClick={() => void onCheck()}
            disabled={busy}
            className="shrink-0 rounded-lg border border-[rgba(0,0,0,0.15)] bg-white px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-ink/[0.03] disabled:opacity-60 dark:border-white/20 dark:bg-surface sm:self-center"
          >
            {busy ? "Scoring…" : "Check match →"}
          </button>
        </div>
      ) : isResumeMatchInsufficient(result) ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-lg font-bold text-ink">{resumeMatchInsufficientTitle()}</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">{resumeMatchInsufficientBody()}</p>
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
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            {result.score !== null ? <MiniRing score={result.score} /> : null}
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold text-ink">You match {result.score}%</p>
              <p className="mt-1 text-sm font-medium text-ink/90">
                &ldquo;{resumeMatchSubtitle(result.grade)}&rdquo;
              </p>
              {isPro ? (
                <p className="mt-2 text-sm text-ink-muted">
                  {result.matched.length} matched · {result.missing.length} gaps
                </p>
              ) : null}
              {hint ? <p className="mt-2 text-xs font-semibold text-brand/90">{hint}</p> : null}
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
