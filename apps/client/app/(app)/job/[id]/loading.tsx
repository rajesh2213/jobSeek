export default function JobDetailLoading() {
  return (
    <div className="min-h-screen px-4 pt-6 sm:px-6">
      <div className="mx-auto max-w-4xl">
        {/* Header skeleton */}
        <div className="space-y-3">
          <div className="h-8 w-4/5 rounded bg-ink/[0.08] animate-pulse" />
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-ink/[0.06] animate-pulse" />
            <div className="space-y-1.5">
              <div className="h-4 w-32 rounded bg-ink/[0.07] animate-pulse" />
              <div className="h-3 w-48 rounded bg-ink/[0.05] animate-pulse" />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="h-6 w-16 rounded-full bg-ink/[0.05] animate-pulse" />
            <div className="h-6 w-20 rounded-full bg-ink/[0.05] animate-pulse" />
            <div className="h-6 w-14 rounded-full bg-ink/[0.05] animate-pulse" />
          </div>
        </div>

        {/* Body skeleton */}
        <div className="mt-8 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-ink/10 bg-surface p-5">
              <div className="h-4 w-28 rounded bg-ink/[0.07] animate-pulse" />
              <div className="mt-3 space-y-2">
                <div className="h-3 w-full rounded bg-ink/[0.04] animate-pulse" />
                <div className="h-3 w-11/12 rounded bg-ink/[0.04] animate-pulse" />
                <div className="h-3 w-4/5 rounded bg-ink/[0.04] animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
