import { Container } from "../ui/Container";

/** Matches hero vertical rhythm while `TimeAdvantageSimulator` chunk loads. */
export function JobsHeroDynamicLoading() {
  return (
    <div
      id="section-hero"
      className="relative w-full pt-10 pb-6 lg:pt-12 lg:pb-8"
      aria-hidden
    >
      <Container width="jobs" className="relative z-[1]">
        <div className="h-[clamp(1.45rem,3.2vw,2.1rem)] w-[min(100%,28rem)] max-w-none rounded-md bg-ink/[0.07] animate-pulse" />
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6">
          <div className="h-12 max-w-2xl flex-1 rounded-md bg-ink/[0.05] animate-pulse" />
          <div className="h-14 w-full max-w-[220px] rounded-xl bg-ink/[0.06] animate-pulse sm:shrink-0" />
        </div>
      </Container>
    </div>
  );
}

/** Filter strip height aligned with `app/(app)/jobs/loading.tsx`. */
export function JobsInlineFiltersDynamicLoading() {
  return (
    <div className="flex flex-wrap items-center gap-3" aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="h-10 rounded-xl bg-ink/[0.06] animate-pulse"
          style={{ width: 100 + i * 20 }}
        />
      ))}
      <div className="h-[42px] w-24 rounded-full bg-brand/20 animate-pulse" />
    </div>
  );
}

/** Placeholder while daily-cap wall chunk loads (only when cap wall is shown). */
export function LimitWallDynamicLoading() {
  return (
    <div
      className="mt-6 space-y-4 rounded-2xl border border-line bg-surface/80 p-6 shadow-sm"
      aria-hidden
    >
      <div className="h-6 w-48 rounded-md bg-ink/[0.08] animate-pulse" />
      <div className="h-24 rounded-xl bg-ink/[0.05] animate-pulse" />
      <div className="flex gap-3">
        <div className="h-10 flex-1 rounded-lg bg-ink/[0.06] animate-pulse" />
        <div className="h-10 w-32 rounded-lg bg-ink/[0.06] animate-pulse" />
      </div>
    </div>
  );
}
