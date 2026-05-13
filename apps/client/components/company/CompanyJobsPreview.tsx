import Link from "next/link";
import type { JobItem } from "../../lib/api";
import { jobCardPinLocationText } from "../../lib/jobDisplay";
import { Card } from "../ui/Card";
import { WorkTypeOutlinePill } from "../job/WorkTypeOutlinePill";

interface Props {
  companySlug: string;
  jobs: JobItem[];
}

export function CompanyJobsPreview({ companySlug, jobs }: Props) {
  const previewJobs = (jobs ?? []).slice(0, 3);
  return (
    <Card accent="brand" as="div" className="p-5">
      <h3 className="text-sm font-extrabold uppercase tracking-wide text-ink/70">More from this company</h3>
      <div className="mt-3 space-y-3">
        {previewJobs.length ? (
          previewJobs.map((job) => (
            <Link
              key={job.id}
              prefetch={false}
              href={`/job/${job.id}`}
              className="block rounded-lg border border-ink/10 px-3 py-2.5 no-underline transition hover:bg-ink/5"
            >
              <p className="line-clamp-2 text-sm font-semibold text-ink">{job.title}</p>
              {jobCardPinLocationText(job) != null && (
                <p className="mt-2 text-[13px] leading-snug text-black/50">📍 {jobCardPinLocationText(job)}</p>
              )}
              <div className="mt-2">
                <WorkTypeOutlinePill job={job} />
              </div>
            </Link>
          ))
        ) : (
          <p className="text-sm text-ink/55">No other roles available right now.</p>
        )}
      </div>
      <div className="mt-4">
        <Link href={`/company/${companySlug}`} className="text-sm font-semibold text-brand no-underline hover:underline">
          View all →
        </Link>
      </div>
    </Card>
  );
}
