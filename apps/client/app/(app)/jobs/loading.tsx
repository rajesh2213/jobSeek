export default function JobsLoading() {
  return (
    <div className="min-h-screen px-4 pt-6 sm:px-6">
      <div className="mx-auto max-w-5xl">
        {/* Filter bar skeleton */}
        <div className="flex flex-wrap items-center gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-10 rounded-xl bg-ink/[0.06] animate-pulse"
              style={{ width: 100 + i * 20 }}
            />
          ))}
          <div className="h-[42px] w-24 rounded-full bg-brand/20 animate-pulse" />
        </div>

        {/* Sort + saved row skeleton */}
        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-2">
            <div className="h-7 w-24 rounded-full bg-ink/[0.06] animate-pulse" />
            <div className="h-7 w-20 rounded-full bg-ink/[0.06] animate-pulse" />
          </div>
          <div className="h-5 w-16 rounded bg-ink/[0.06] animate-pulse" />
        </div>

        {/* Job cards skeleton */}
        <div className="mt-6 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-ink/10 bg-surface p-5"
            >
              <div className="flex items-start gap-4">
                <div className="h-10 w-10 shrink-0 rounded-lg bg-ink/[0.06] animate-pulse" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-4 w-3/5 rounded bg-ink/[0.08] animate-pulse" />
                  <div className="h-3 w-2/5 rounded bg-ink/[0.05] animate-pulse" />
                  <div className="flex gap-2 pt-1">
                    <div className="h-5 w-14 rounded-full bg-ink/[0.05] animate-pulse" />
                    <div className="h-5 w-16 rounded-full bg-ink/[0.05] animate-pulse" />
                    <div className="h-5 w-12 rounded-full bg-ink/[0.05] animate-pulse" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
