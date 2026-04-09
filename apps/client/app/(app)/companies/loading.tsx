export default function CompaniesLoading() {
  return (
    <div className="min-h-screen px-4 pt-8 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="h-8 w-40 rounded bg-ink/[0.08] animate-pulse" />
        <div className="mt-2 h-4 w-64 rounded bg-ink/[0.05] animate-pulse" />

        {/* Search bar skeleton */}
        <div className="mt-6 rounded-2xl border border-ink/10 bg-surface p-4">
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-24 rounded bg-ink/[0.06] animate-pulse" />
              <div className="h-10 rounded-lg bg-ink/[0.05] animate-pulse" />
            </div>
            <div className="h-10 w-20 rounded-full bg-brand/20 animate-pulse" />
          </div>
        </div>

        {/* Company list skeleton */}
        <div className="mt-6 space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-ink/10 bg-surface p-4"
            >
              <div className="h-4 w-2/5 rounded bg-ink/[0.08] animate-pulse" />
              <div className="mt-2 h-3 w-1/4 rounded bg-ink/[0.05] animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
