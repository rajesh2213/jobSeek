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
      <div className="mt-8 space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-ink/10 bg-surface p-5 shadow-card"
          >
            <div className="flex gap-4">
              <div className="h-12 w-12 shrink-0 animate-pulse rounded-lg bg-ink/[0.06]" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-[55%] animate-pulse rounded bg-ink/[0.08]" />
                <div className="h-3 w-[35%] animate-pulse rounded bg-ink/[0.05]" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
