export function JobCardSkeleton() {
  return (
    <article
      className="rounded-2xl border border-ink/5 bg-surface p-7 shadow-card"
      aria-hidden
    >
      <div className="mb-4 flex justify-between gap-3">
        <div className="h-4 w-28 animate-pulse rounded-lg bg-ink/10" />
        <div className="h-6 w-16 animate-pulse rounded-full bg-teal/15" />
      </div>
      <div className="flex gap-5">
        <div className="h-12 w-12 shrink-0 animate-pulse rounded-xl bg-teal/10" />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="h-7 max-w-lg animate-pulse rounded-lg bg-ink/10" />
          <div className="h-4 w-2/5 animate-pulse rounded-lg bg-ink/10" />
          <div className="h-14 w-full animate-pulse rounded-xl bg-ink/5" />
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2 pt-4">
        <div className="h-9 w-20 animate-pulse rounded-full bg-ink/10" />
        <div className="h-9 w-24 animate-pulse rounded-full bg-brand/20" />
      </div>
    </article>
  );
}

export function JobListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-5">
      {Array.from({ length: count }).map((_, i) => (
        <JobCardSkeleton key={i} />
      ))}
    </div>
  );
}
