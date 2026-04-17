"use client";

interface ReadinessCockpitProps {
  hasResume: boolean;
  profileCompletionPct: number;
  extensionConnected: boolean;
  jobsRemaining: number | null;
  resetsAt: string | null;
}

function Item({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2">
      <p className="text-xs font-semibold text-ink">{label}</p>
      <p className={`mt-0.5 text-xs ${ok ? "text-emerald-700" : "text-amber-700"}`}>
        {ok ? "Ready" : "Needs attention"} · {detail}
      </p>
    </div>
  );
}

export function ReadinessCockpit({
  hasResume,
  profileCompletionPct,
  extensionConnected,
  jobsRemaining,
  resetsAt,
}: ReadinessCockpitProps) {
  const profileReady = profileCompletionPct >= 60;
  const quotaReady = jobsRemaining == null || jobsRemaining > 0;
  const quotaDetail =
    jobsRemaining == null
      ? "Unlimited"
      : jobsRemaining > 0
        ? `${jobsRemaining} jobs remaining today`
        : `0 remaining · resets ${resetsAt ? new Date(resetsAt).toLocaleString() : "soon"}`;

  return (
    <section className="mb-4 rounded-2xl border border-line bg-surface p-4 shadow-card ring-1 ring-ink/5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold text-ink">Readiness cockpit</h2>
        <span className="rounded-full bg-brand/10 px-2.5 py-1 text-[11px] font-semibold text-brand">
          Review-first workflow
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Item label="Resume" ok={hasResume} detail={hasResume ? "Uploaded" : "Upload required"} />
        <Item
          label="Profile quality"
          ok={profileReady}
          detail={`${profileCompletionPct}% complete`}
        />
        <Item
          label="Extension"
          ok={extensionConnected}
          detail={extensionConnected ? "Connected on this browser" : "Install or reload extension"}
        />
        <Item label="Daily quota" ok={quotaReady} detail={quotaDetail} />
      </div>
    </section>
  );
}
