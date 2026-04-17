"use client";

interface ProofStripProps {
  applicationsAssisted: number;
  jobsLimit: number | null;
  profileCompletionPct: number;
  setupMinutes: number;
}

export function ProofStrip({
  applicationsAssisted,
  jobsLimit,
  profileCompletionPct,
  setupMinutes,
}: ProofStripProps) {
  return (
    <section className="mb-4 grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-line bg-surface px-4 py-3 shadow-card ring-1 ring-ink/5">
        <p className="text-[11px] uppercase tracking-wide text-ink/55">Today</p>
        <p className="mt-1 text-lg font-bold text-ink">
          {applicationsAssisted}
          {jobsLimit != null ? ` / ${jobsLimit}` : ""} applications assisted
        </p>
        <p className="text-xs text-ink-muted">Tracked from Smart Apply daily usage.</p>
      </div>
      <div className="rounded-xl border border-line bg-surface px-4 py-3 shadow-card ring-1 ring-ink/5">
        <p className="text-[11px] uppercase tracking-wide text-ink/55">Profile readiness</p>
        <p className="mt-1 text-lg font-bold text-ink">{profileCompletionPct}% complete</p>
        <p className="text-xs text-ink-muted">More context improves personalization quality.</p>
      </div>
      <div className="rounded-xl border border-line bg-surface px-4 py-3 shadow-card ring-1 ring-ink/5">
        <p className="text-[11px] uppercase tracking-wide text-ink/55">Setup Speed</p>
        <p className="mt-1 text-lg font-bold text-ink">~{setupMinutes} minutes to start</p>
        <p className="text-xs text-ink-muted">Upload resume, import profile, install extension, then apply.</p>
      </div>
    </section>
  );
}
