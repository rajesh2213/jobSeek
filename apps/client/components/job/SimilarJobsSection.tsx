import type { JobItem } from "../../lib/api";
import { JobCard } from "./JobCard";

interface Props {
  jobs: JobItem[];
}

export function SimilarJobsSection({ jobs }: Props) {
  if (!jobs.length) return null;
  return (
    <section className="mt-12 space-y-6 py-6">
      <h2 className="text-xl font-extrabold tracking-tight text-ink">Similar jobs</h2>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} compact />
        ))}
      </div>
    </section>
  );
}
