"use client";

interface HeroPositioningProps {
  isPaid: boolean;
  planLabel: string | null;
  completionPct: number;
}

export function HeroPositioning({ isPaid, planLabel, completionPct }: HeroPositioningProps) {
  return (
    <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="font-sans text-2xl font-bold tracking-tight text-ink">
          Smart Apply Workspace
          {isPaid && planLabel ? (
            <span className="ml-2 rounded-full bg-brand/15 px-2 py-0.5 text-xs font-bold text-brand">
              {planLabel}
            </span>
          ) : null}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          <span className="font-semibold text-brand">
            One-click ATS autofill with human-sounding long-answer drafts that still sound like you.
          </span>{" "}
          Resume is required. Every other field is optional and helps improve personalization quality.
        </p>
      </div>
      <span className="rounded-full bg-ink/5 px-3 py-1 text-xs text-ink-muted">
        Completion {completionPct}%
      </span>
    </div>
  );
}
