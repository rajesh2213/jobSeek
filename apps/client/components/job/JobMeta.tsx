import type { JobItem } from "../../lib/api";
import { formatTimeAgo } from "../../lib/format";

export function JobMeta({ job }: { job: JobItem }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-ink/65">
      <span>{job.country}</span>
      <span>·</span>
      <span>{job.workType ?? (job.isRemote ? "remote" : "onsite")}</span>
      <span>·</span>
      <span>{job.role.replace(/-/g, " ")}</span>
      <span>·</span>
      <span>{formatTimeAgo(job.effectivePostedAt ?? job.createdAt)}</span>
    </div>
  );
}
