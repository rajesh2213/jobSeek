function CompanyHubJobCardSkeleton({ index }: { index: number }) {
  return (
    <div
      className="rounded-2xl border border-ink/10 bg-surface p-5 shadow-card"
      aria-hidden
    >
      <div className="flex gap-4">
        <div className="h-12 w-12 shrink-0 animate-pulse rounded-lg bg-ink/[0.06]" />
        <div className="min-w-0 flex-1 space-y-2.5">
          <div
            className="h-3 w-24 animate-pulse rounded bg-ink/[0.05]"
            style={{ animationDelay: `${index * 75}ms` }}
          />
          <div
            className="h-4 w-[62%] max-w-md animate-pulse rounded bg-ink/[0.08]"
            style={{ animationDelay: `${index * 75 + 40}ms` }}
          />
          <div className="flex gap-2 pt-1">
            <div className="h-3 w-20 animate-pulse rounded bg-ink/[0.05]" />
            <div className="h-3 w-16 animate-pulse rounded bg-ink/[0.05]" />
            <div className="h-5 w-14 animate-pulse rounded-full bg-ink/[0.05]" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Job list placeholder while client hydrates company roles. */
export function CompanyHubJobsListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <section
      className="mt-8 flex flex-col gap-5"
      aria-label="Loading company roles"
      aria-busy="true"
    >
      {Array.from({ length: count }).map((_, idx) => (
        <CompanyHubJobCardSkeleton key={`hub-job-skeleton-${idx}`} index={idx} />
      ))}
    </section>
  );
}

export function CompanyHubSkeleton() {
  return (
    <div className="mx-auto min-h-screen max-w-[1100px] px-6 py-8">
      <div className="flex gap-4">
        <div className="h-16 w-16 shrink-0 animate-pulse rounded-xl bg-ink/[0.08]" />
        <div className="flex-1 space-y-2">
          <div className="h-7 w-48 animate-pulse rounded-lg bg-ink/[0.08]" />
          <div className="h-4 w-64 animate-pulse rounded bg-ink/[0.05]" />
          <div className="flex gap-2">
            <div className="h-6 w-24 animate-pulse rounded-full bg-ink/[0.06]" />
            <div className="h-6 w-20 animate-pulse rounded-full bg-ink/[0.06]" />
          </div>
        </div>
      </div>
      <div className="mt-6 h-24 animate-pulse rounded-2xl bg-ink/[0.05]" />
      <CompanyHubJobsListSkeleton />
    </div>
  );
}
