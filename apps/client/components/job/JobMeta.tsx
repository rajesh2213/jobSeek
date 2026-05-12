import type { JobItem } from "../../lib/api";
import { FreshnessLine } from "./FreshnessIndicator";

export function JobMeta({ job }: { job: JobItem }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-ink/65">
      <span>{job.country}</span>
      <span>·</span>
      <span>{job.workType ?? (job.isRemote ? "remote" : "onsite")}</span>
      <span>·</span>
      <span>{job.role.replace(/-/g, " ")}</span>
      <span>·</span>
      <FreshnessLine job={job} className="text-sm tracking-normal normal-case text-ink/65" />
    </div>
  );
}
