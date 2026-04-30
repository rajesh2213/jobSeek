"use client";

import { useEffect, useState } from "react";
import {
  fetchCompanyJobs,
  fetchJobs,
  isJobReady,
  type JobItem,
} from "../../lib/api";
import { rankSimilarJobs } from "../../lib/similarJobsRank";
import { CompanyJobsPreview } from "../company/CompanyJobsPreview";
import { SimilarJobsSection } from "./SimilarJobsSection";

export function CompanyJobsPreviewDeferred({ job }: { job: JobItem }) {
  const [companyJobs, setCompanyJobs] = useState<JobItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchCompanyJobs(job.company.slug, { limit: 5 })
      .then((companyJobsRes) => {
        if (cancelled) return;
        const nextCompanyJobs = (companyJobsRes.data ?? [])
          .filter((x) => x.id !== job.id && isJobReady(x))
          .slice(0, 3);
        setCompanyJobs(nextCompanyJobs);
      })
      .catch(() => {
        /* non-critical */
      });
    return () => {
      cancelled = true;
    };
  }, [job]);

  return <CompanyJobsPreview companySlug={job.company.slug} jobs={companyJobs} />;
}

export function SimilarJobsDeferred({ job }: { job: JobItem }) {
  const [similarJobs, setSimilarJobs] = useState<JobItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchJobs({ category: job.category, limit: 20 })
      .then((similarRes) => {
        if (cancelled) return;
        const nextSimilar = rankSimilarJobs(
          job,
          (similarRes.data ?? []).filter(isJobReady),
          6,
        );
        setSimilarJobs(nextSimilar);
      })
      .catch(() => {
        /* non-critical */
      });
    return () => {
      cancelled = true;
    };
  }, [job]);

  return <SimilarJobsSection jobs={similarJobs} />;
}
