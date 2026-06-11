const JOB_DETAIL_TAG_PREFIX = "job-detail";

export function jobDetailCacheTag(jobId: string): string {
  const id = jobId.trim();
  if (!id) throw new Error("jobDetailCacheTag: missing job id");
  return `${JOB_DETAIL_TAG_PREFIX}:${id}`;
}

export function jobDetailPagePath(jobId: string): string {
  const id = jobId.trim();
  if (!id) throw new Error("jobDetailPagePath: missing job id");
  return `/job/${id}`;
}
