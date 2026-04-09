export default function PricingLoading() {
  return (
    <div className="min-h-screen px-4 pt-8 sm:px-6">
      <div className="mx-auto max-w-3xl text-center">
        <div className="mx-auto h-8 w-56 rounded bg-ink/[0.08] animate-pulse" />
        <div className="mx-auto mt-3 h-4 w-80 rounded bg-ink/[0.05] animate-pulse" />
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-ink/10 bg-surface p-6">
              <div className="h-4 w-16 rounded bg-ink/[0.07] animate-pulse" />
              <div className="mt-3 h-10 w-20 rounded bg-ink/[0.08] animate-pulse" />
              <div className="mt-4 space-y-2">
                <div className="h-3 w-full rounded bg-ink/[0.04] animate-pulse" />
                <div className="h-3 w-4/5 rounded bg-ink/[0.04] animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
