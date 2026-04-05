import { Container } from "../ui/Container";
import { JobListSkeleton } from "./JobCardSkeleton";

export function JobsShellSkeleton() {
  return (
    <div className="min-h-screen">
      <Container className="py-10">
        <div className="mb-8 flex flex-col gap-3 sm:mb-10">
          <div className="h-8 w-48 animate-pulse rounded-lg bg-ink/10" />
          <div className="h-12 w-full max-w-md animate-pulse rounded-lg bg-ink/10" />
          <div className="h-4 w-64 max-w-full animate-pulse rounded-lg bg-ink/10" />
        </div>
        <div className="mb-6 flex flex-wrap gap-2.5">
          <div className="h-11 w-28 animate-pulse rounded-full bg-surface ring-1 ring-ink/5" />
          <div className="h-11 w-32 animate-pulse rounded-full bg-surface ring-1 ring-ink/5" />
          <div className="h-11 w-24 animate-pulse rounded-full bg-surface ring-1 ring-ink/5" />
        </div>
        <JobListSkeleton count={4} />
      </Container>
    </div>
  );
}
