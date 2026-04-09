export default function AccountLoading() {
  return (
    <div className="min-h-screen px-4 pt-8 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="h-8 w-32 rounded bg-ink/[0.08] animate-pulse" />
        <div className="mt-6 rounded-2xl border border-ink/10 bg-surface p-6">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-full bg-ink/[0.06] animate-pulse" />
            <div className="space-y-2">
              <div className="h-5 w-40 rounded bg-ink/[0.08] animate-pulse" />
              <div className="h-3 w-56 rounded bg-ink/[0.05] animate-pulse" />
            </div>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-ink/10 bg-surface p-5">
              <div className="h-4 w-28 rounded bg-ink/[0.07] animate-pulse" />
              <div className="mt-3 h-3 w-4/5 rounded bg-ink/[0.04] animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
