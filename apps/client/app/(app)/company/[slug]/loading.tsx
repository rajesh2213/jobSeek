export default function CompanyDetailLoading() {
  return (
    <div className="min-h-screen px-4 pt-6 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-xl bg-ink/[0.06] animate-pulse" />
          <div className="space-y-2">
            <div className="h-6 w-48 rounded bg-ink/[0.08] animate-pulse" />
            <div className="h-3 w-32 rounded bg-ink/[0.05] animate-pulse" />
          </div>
        </div>
        <div className="mt-8 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-ink/10 bg-surface p-5">
              <div className="flex items-start gap-4">
                <div className="h-10 w-10 shrink-0 rounded-lg bg-ink/[0.06] animate-pulse" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-4 w-3/5 rounded bg-ink/[0.08] animate-pulse" />
                  <div className="h-3 w-2/5 rounded bg-ink/[0.05] animate-pulse" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
