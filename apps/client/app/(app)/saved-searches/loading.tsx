export default function SavedSearchesLoading() {
  return (
    <div className="min-h-screen px-4 pt-8 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="h-8 w-44 rounded bg-ink/[0.08] animate-pulse" />
        <div className="mt-6 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-ink/10 bg-surface p-5">
              <div className="h-4 w-2/5 rounded bg-ink/[0.08] animate-pulse" />
              <div className="mt-3 flex gap-2">
                <div className="h-5 w-20 rounded-full bg-ink/[0.05] animate-pulse" />
                <div className="h-5 w-16 rounded-full bg-ink/[0.05] animate-pulse" />
                <div className="h-5 w-24 rounded-full bg-ink/[0.05] animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
