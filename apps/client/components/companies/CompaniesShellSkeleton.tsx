export function CompaniesShellSkeleton() {
  return (
    <div className="mx-auto min-h-screen max-w-[1100px] px-6 py-6">
      <div className="h-9 w-48 animate-pulse rounded-lg bg-ink/10" />
      <div className="mt-2 h-4 w-72 max-w-full animate-pulse rounded bg-ink/[0.06]" />
      <div className="mt-6 flex flex-wrap gap-3">
        <div className="h-10 min-w-[12rem] flex-1 animate-pulse rounded-2xl bg-ink/[0.06]" />
        <div className="h-10 w-36 animate-pulse rounded-2xl bg-ink/[0.06]" />
        <div className="h-9 w-28 animate-pulse rounded-full bg-ink/[0.06]" />
        <div className="h-9 w-32 animate-pulse rounded-full bg-ink/[0.06]" />
      </div>
      <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-ink/10 bg-surface p-5 shadow-card"
          >
            <div className="flex gap-4">
              <div className="h-12 w-12 shrink-0 animate-pulse rounded-lg bg-ink/[0.08]" />
              <div className="flex-1 space-y-2 pt-1">
                <div className="h-4 w-[60%] animate-pulse rounded bg-ink/[0.08]" />
                <div className="h-3 w-[40%] animate-pulse rounded bg-ink/[0.05]" />
              </div>
            </div>
            <div className="mt-4 flex justify-between">
              <div className="h-3 w-20 animate-pulse rounded bg-ink/[0.05]" />
              <div className="h-3 w-24 animate-pulse rounded bg-ink/[0.05]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
