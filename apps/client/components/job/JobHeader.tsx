import Link from "next/link";
import type { JobItem } from "../../lib/api";
import { formatTimeAgo } from "../../lib/format";
import { jobDetailPinLocationText, workTypeDisplayLabel } from "../../lib/jobDisplay";
import { ApplyJobButton } from "./ApplyJobButton";
import { AppliedToggleButton } from "./AppliedToggleButton";
import { buttonClassName } from "../ui/Button";

interface Props {
  job: JobItem;
  applyHref: string;
  /** Free tier hit daily browse cap — external apply URL hidden until Pro. */
  applyUrlLocked?: boolean;
}

export function JobHeader({ job, applyHref, applyUrlLocked }: Props) {
  return (
    <header className="space-y-3">
      <div className="flex flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-xs font-bold uppercase tracking-wider text-ink/45">{job.category.replace(/-/g, " ")}</p>
        <p className="shrink-0 text-xs font-medium text-ink/45">{formatTimeAgo(job.postedAt, job.createdAt)}</p>
      </div>
      <h1 className="font-display text-3xl font-normal italic text-ink sm:text-4xl">{job.title}</h1>
      <div className="flex flex-row flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 space-y-3">
          <p className="text-sm text-ink/60">
            at{" "}
            <Link href={`/company/${job.company.slug}`} className="font-semibold text-ink no-underline hover:text-brand">
              {job.company.name}
            </Link>
          </p>
          <p className="text-sm leading-relaxed text-black/50">
            <span>📍 {jobDetailPinLocationText(job)}</span>
            <span className="mx-2 text-ink/25">·</span>
            <span>🏢 {workTypeDisplayLabel(job)}</span>
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {applyUrlLocked ? (
            <Link
              href="/pricing"
              className={buttonClassName({
                variant: "primary",
                size: "md",
                className: "no-underline",
              })}
            >
              Upgrade to view & apply
            </Link>
          ) : (
            <ApplyJobButton jobId={job.id} applyUrl={applyHref} variant="primary" size="md" />
          )}
          <AppliedToggleButton jobId={job.id} size="md" />
        </div>
      </div>
    </header>
  );
}
