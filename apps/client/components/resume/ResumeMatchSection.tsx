"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { JobItem } from "../../lib/api";
import { fetchResumeSemanticMatch } from "../../lib/api";
import { resumeMatchSubtitle } from "../../lib/resumeGradeLabel";
import {
  extractJobKeywords,
  isResumeLegacyKeywordMode,
  scoreResume,
  type ScoringResult,
} from "../../lib/resumeScorer";
import { extractJobSkills, jobSkillCanonicalsForSemantic } from "../../lib/skillExtractor";
import { useResume } from "../../lib/resumeContext";
import { useAccountPlan } from "../../lib/useAccountPlan";
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

export function ResumeMatchSection({ job }: { job: JobItem }) {
  const { isSignedIn, getToken } = useAuth();
  const { isPro, isLoaded: planLoaded } = useAccountPlan();
  const { hasResume, resumeText, resumeBullets } = useResume();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScoringResult | null>(null);
  const pendingScoreAfterUploadRef = useRef(false);

  useEffect(() => {
    setResult(null);
  }, [job.id]);

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

    setResult(scoreResume(text, bullets, job, semantic));
  }, [getToken, job, resumeBullets, resumeText]);

  const onCheck = async () => {
    if (!hasResume) {
      setUploadOpen(true);
      return;
    }
    setBusy(true);
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

  if (!isPro) {
    return (
      <section className="rounded-2xl border border-ink/10 bg-surface/80 p-5 shadow-sm ring-1 ring-ink/5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-base font-semibold text-ink">
              <span aria-hidden className="mr-1.5">
                📄
              </span>
              AI resume match
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              See your fit score, matched keywords, and gaps for this role — Pro only.
            </p>
          </div>
          <Link
            href="/pricing"
            className="shrink-0 rounded-lg bg-brand px-4 py-2.5 text-center text-sm font-semibold text-white no-underline transition-colors hover:bg-brand-hover sm:self-center"
          >
            Upgrade to Pro →
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-ink/10 bg-surface/80 p-5 shadow-sm ring-1 ring-ink/5">
      {!result ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-base font-semibold text-ink">
              <span aria-hidden className="mr-1.5">
                📄
              </span>
              Check your resume match
            </p>
            <p className="mt-1 text-sm text-ink-muted">See how well your profile fits</p>
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
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <MiniRing score={result.score} />
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold text-ink">{result.score}% match</p>
              <p className="mt-1 text-sm font-medium text-ink/90">
                &ldquo;{resumeMatchSubtitle(result.grade)}&rdquo;
              </p>
              <p className="mt-2 text-sm text-ink-muted">
                {result.matched.length} matched · {result.missing.length} gaps
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              className="w-full flex-1 rounded-lg border border-ink/15 bg-white py-3 text-center text-sm font-semibold text-ink transition-colors hover:bg-ink/5 dark:bg-surface"
            >
              See full breakdown →
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
        onReuploadResume={() => {
          setPanelOpen(false);
          setUploadOpen(true);
        }}
      />
    </section>
  );
}
