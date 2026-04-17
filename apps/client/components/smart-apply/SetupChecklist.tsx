"use client";

export function SetupChecklist() {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-card ring-1 ring-ink/5">
      <h2 className="text-sm font-bold text-ink">3-step Smart Apply flow</h2>
      <ol className="mt-2 list-decimal space-y-2 pl-4 text-xs text-ink-muted">
        <li>Upload resume and import your profile context.</li>
        <li>Open any ATS application page and run one-click autofill.</li>
        <li>Review generated long answers, edit quickly, then submit manually.</li>
      </ol>
    </section>
  );
}
