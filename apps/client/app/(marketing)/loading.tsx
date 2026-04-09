export default function MarketingLoading() {
  return (
    <div className="min-h-screen bg-canvas px-4 pt-10 sm:px-6">
      <div className="mx-auto max-w-6xl">
        {/* Hero skeleton */}
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div className="space-y-4">
            <div className="flex gap-2">
              <div className="h-7 w-40 rounded-full bg-ink/[0.05] animate-pulse" />
              <div className="h-7 w-32 rounded-full bg-ink/[0.05] animate-pulse" />
            </div>
            <div className="h-12 w-4/5 rounded bg-ink/[0.08] animate-pulse" />
            <div className="h-12 w-3/5 rounded bg-ink/[0.06] animate-pulse" />
            <div className="h-5 w-full max-w-lg rounded bg-ink/[0.04] animate-pulse" />
            <div className="flex gap-3 pt-4">
              <div className="h-11 w-44 rounded-full bg-brand/20 animate-pulse" />
              <div className="h-11 w-28 rounded-full bg-ink/[0.06] animate-pulse" />
            </div>
          </div>
          <div className="mx-auto h-80 w-full max-w-xl rounded-2xl bg-ink/[0.04] animate-pulse" />
        </div>
      </div>
    </div>
  );
}
