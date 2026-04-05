import type { JobItem } from "../../lib/api";
import { JobCard } from "./JobCard";

interface Props {
  jobs: JobItem[];
}

export function JobList({ jobs }: Props) {
  if (jobs.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line bg-white px-6 py-12 text-center text-sm text-ink-muted">
        No jobs found for the selected filters.
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-5" aria-label="Job results">
      {jobs.map((job) => (
        <JobCard key={job.id} job={job} />
      ))}
    </section>
  );
}
