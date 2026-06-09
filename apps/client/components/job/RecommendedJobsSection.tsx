"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { fetchApplyProfile, fetchJobs, isJobReady, type JobItem } from "../../lib/api";
import {
  trackRecommendedJobClicked,
  trackRecommendedJobsViewed,
} from "../../lib/analytics/resumeMatchFunnel";
import {
  deriveCandidateRoleFamily,
  deriveJobRoleFamily,
  type CandidateTitleInput,
  type RoleFamily,
} from "../../lib/resumeFitTitle";
import {
  getRecommendedJobsForCandidate,
  RECOMMENDED_JOBS_POOL_LIMIT,
} from "../../lib/recommendedJobsForCandidate";
import { rememberFitSurface } from "../../lib/analytics/fitSurface";
import { recommendedJobsSubtitle } from "../../lib/recommendedJobsFamilyLabel";
import { isResumeFeedPersonalizationEnabled } from "../../lib/resumeFeedPersonalizationFlag";
import { useResume } from "../../lib/resumeContext";
import { RecommendedJobCard } from "./RecommendedJobCard";

function applyProfileTitleInput(
  profile: Awaited<ReturnType<typeof fetchApplyProfile>>,
  resumeText: string | null,
): CandidateTitleInput {
  return {
    currentTitle: profile?.currentTitle ?? null,
    resumeStructuredV1: profile?.resumeStructuredV1 as CandidateTitleInput["resumeStructuredV1"],
    applyProfileSummary: profile?.applyProfileSummary as CandidateTitleInput["applyProfileSummary"],
    resumeText,
  };
}

export function RecommendedJobsSection() {
  const { isSignedIn, getToken } = useAuth();
  const { hasResume, resumeText, isLoading: resumeLoading } = useResume();
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [candidateFamily, setCandidateFamily] = useState<RoleFamily | null>(null);
  const [loading, setLoading] = useState(false);
  const viewedRef = useRef(false);

  const enabled = isResumeFeedPersonalizationEnabled();

  useEffect(() => {
    if (!enabled || !isSignedIn || !hasResume || resumeLoading) {
      setJobs([]);
      setCandidateFamily(null);
      viewedRef.current = false;
      return;
    }

    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        const token = await getToken();
        if (!token || cancelled) return;

        const [profile, listing] = await Promise.all([
          fetchApplyProfile(token),
          fetchJobs({ limit: RECOMMENDED_JOBS_POOL_LIMIT, page: 1 }, { token }),
        ]);

        if (cancelled) return;

        const derived = deriveCandidateRoleFamily(applyProfileTitleInput(profile, resumeText));
        if (!derived.family) {
          setCandidateFamily(null);
          setJobs([]);
          return;
        }

        const pool = listing.data.filter(isJobReady);
        const recommended = getRecommendedJobsForCandidate(derived.family, pool);
        setCandidateFamily(derived.family);
        setJobs(recommended);
      } catch {
        if (!cancelled) {
          setCandidateFamily(null);
          setJobs([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, getToken, hasResume, isSignedIn, resumeLoading, resumeText]);

  useEffect(() => {
    if (!candidateFamily || jobs.length === 0 || viewedRef.current) return;
    viewedRef.current = true;
    trackRecommendedJobsViewed({
      candidateFamily,
      jobCount: jobs.length,
      surface: "recommended_carousel",
    });
  }, [candidateFamily, jobs.length]);

  const onCarouselClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!candidateFamily) return;
      const anchor = (event.target as HTMLElement).closest('a[href^="/job/"]');
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      const jobId = href.replace(/^\/job\//, "").split("?")[0]?.trim();
      if (!jobId) return;
      const match = jobs.find((j) => j.id === jobId);
      if (!match) return;
      const jobFamily = deriveJobRoleFamily(match).family;
      trackRecommendedJobClicked({
        candidateFamily,
        jobFamily,
        jobId,
        surface: "recommended_carousel",
      });
      rememberFitSurface(jobId, "recommended_carousel");
    },
    [candidateFamily, jobs],
  );

  if (!enabled || !isSignedIn || !hasResume) return null;
  if (loading) return null;
  if (!candidateFamily || jobs.length === 0) return null;

  return (
    <section
      aria-label="Recommended for your background"
      className="mb-6 rounded-xl border border-ink/8 bg-surface px-3 py-3.5 sm:px-4 sm:py-4"
    >
      <div className="mb-3 px-0.5">
        <h2 className="text-base font-bold tracking-tight text-ink sm:text-[17px]">
          Recommended for your background
        </h2>
        <p className="mt-0.5 text-xs text-ink-muted sm:text-[13px]">
          {recommendedJobsSubtitle(candidateFamily)}
        </p>
      </div>
      <div
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 pt-0.5 [scrollbar-width:thin]"
        onClick={onCarouselClick}
      >
        {jobs.map((job) => (
          <div key={job.id} className="w-[15.5rem] shrink-0 snap-start sm:w-[16.5rem]">
            <RecommendedJobCard job={job} />
          </div>
        ))}
      </div>
    </section>
  );
}
