import Link from "next/link";
import type { JobItem } from "../../lib/api";
import { jobDetailPinLocationText } from "../../lib/jobDisplay";
import { isJobBusinessOpen } from "../../lib/jobLifecycle";
import { ApplyJobButton } from "./ApplyJobButton";
import { AppliedToggleButton } from "./AppliedToggleButton";
import { WorkTypeOutlinePill } from "./WorkTypeOutlinePill";
import { FreshnessLine } from "./FreshnessIndicator";

interface Props {
  job: JobItem;
  applyHref: string;
}

export function JobHeader({ job, applyHref }: Props) {
  const businessOpen = isJobBusinessOpen(job);
  const canApply = businessOpen && Boolean(applyHref.trim());

  return (
    <header className="space-y-3">
      <div className="flex flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-xs font-bold uppercase tracking-wider text-ink/45">
          {(job.category ?? "other").replace(/-/g, " ")}
        </p>
        {/* Backend-owned Posted/Added prefix — never inferred client-side. */}
        <FreshnessLine
          job={job}
          className="shrink-0 text-xs font-medium tracking-normal normal-case text-ink/45"
        />
      </div>
      <h1 className="font-display text-3xl font-normal italic text-ink sm:text-4xl">{job.title}</h1>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-x-4 sm:gap-y-3">
        <div className="min-w-0 space-y-3">
          <p className="text-sm text-ink/60">
            at{" "}
            <Link href={`/company/${job.company.slug}`} className="font-semibold text-ink no-underline hover:text-brand">
              {job.company.name}
            </Link>
          </p>
          <div className="flex min-w-0 flex-row flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-snug text-black/50">
            {(() => {
              const locationText = jobDetailPinLocationText(job);
              return locationText ? (
                <span className="inline-flex min-w-0 max-w-full items-center gap-1">
                  <span className="shrink-0" aria-hidden>
                    📍
                  </span>
                  <span className="min-w-0 sm:truncate">{locationText}</span>
                </span>
              ) : null;
            })()}
            <WorkTypeOutlinePill job={job} className="shrink-0" />
            {!businessOpen ? (
              <span className="rounded-md border border-ink/15 bg-ink/5 px-2 py-0.5 text-xs font-semibold text-ink/60">
                Possibly closed
              </span>
            ) : null}
          </div>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:shrink-0 sm:items-center">
          {canApply ? (
            <ApplyJobButton
              jobId={job.id}
              company={job.company.name}
              source="job_detail_header"
              applyUrl={applyHref}
              variant="primary"
              size="md"
              className="w-full justify-center sm:w-auto"
            />
          ) : (
            <Link
              href={`/company/${job.company.slug}`}
              className="inline-flex w-full items-center justify-center rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white no-underline hover:bg-brand-hover sm:w-auto"
            >
              More at {job.company.name}
            </Link>
          )}
          <AppliedToggleButton jobId={job.id} size="md" className="w-full justify-center sm:w-auto" />
        </div>
      </div>
    </header>
  );
}
