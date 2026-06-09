import type { JobItem } from "./api";
import {
  deriveJobRoleFamily,
  titleFitRelation,
  type RoleFamily,
} from "./resumeFitTitle";

export const RECOMMENDED_JOBS_LIMIT = 5;
export const RECOMMENDED_JOBS_POOL_LIMIT = 100;

export const SAME_FAMILY_BOOST = 100;
export const ADJACENT_FAMILY_BOOST = 40;

export type RecommendedJobBucket = "same_family" | "adjacent_family";

export interface RankedRecommendedJob {
  job: JobItem;
  boost: number;
  bucket: RecommendedJobBucket;
  jobFamily: RoleFamily | null;
}

interface RankedRecommendedJobInternal extends RankedRecommendedJob {
  idx: number;
}

function jobFreshnessMs(job: JobItem): number {
  const t = job.effectivePostedAt ?? job.postedAt ?? job.createdAt;
  return t ? new Date(t).getTime() : 0;
}

export function familyBoostForRecommendation(
  candidateFamily: RoleFamily,
  jobFamily: RoleFamily | null,
): number {
  if (!jobFamily) return 0;
  const relation = titleFitRelation(candidateFamily, jobFamily);
  if (relation === "same") return SAME_FAMILY_BOOST;
  if (relation === "adjacent") return ADJACENT_FAMILY_BOOST;
  return 0;
}

export function rankRecommendedJobsForCandidate(
  candidateFamily: RoleFamily,
  jobs: JobItem[],
): RankedRecommendedJob[] {
  const ranked: RankedRecommendedJobInternal[] = [];

  for (let idx = 0; idx < jobs.length; idx++) {
    const job = jobs[idx]!;
    const { family: jobFamily } = deriveJobRoleFamily(job);
    const boost = familyBoostForRecommendation(candidateFamily, jobFamily);
    if (boost === 0) continue;
    ranked.push({
      job,
      boost,
      bucket: boost === SAME_FAMILY_BOOST ? "same_family" : "adjacent_family",
      jobFamily,
      idx,
    });
  }

  ranked.sort((a, b) => {
    if (b.boost !== a.boost) return b.boost - a.boost;
    const freshDiff = jobFreshnessMs(b.job) - jobFreshnessMs(a.job);
    if (freshDiff !== 0) return freshDiff;
    return a.idx - b.idx;
  });

  return ranked.map(({ job, boost, bucket, jobFamily }) => ({ job, boost, bucket, jobFamily }));
}

export function getRecommendedJobsForCandidate(
  candidateFamily: RoleFamily,
  jobs: JobItem[],
  limit = RECOMMENDED_JOBS_LIMIT,
): JobItem[] {
  return rankRecommendedJobsForCandidate(candidateFamily, jobs)
    .slice(0, limit)
    .map((r) => r.job);
}
