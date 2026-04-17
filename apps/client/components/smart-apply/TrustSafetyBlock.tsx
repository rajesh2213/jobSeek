"use client";

export function TrustSafetyBlock() {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-card ring-1 ring-ink/5">
      <h2 className="text-sm font-bold text-ink">Trust and safety</h2>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold text-ink/80">What Smart Apply does</p>
          <ul className="mt-1 space-y-1 text-xs text-ink-muted">
            <li>Auto-fills repetitive ATS form fields from your saved profile.</li>
            <li>Drafts long written answers aligned to your resume and preferences.</li>
            <li>Keeps all output editable before you submit.</li>
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold text-ink/80">What Smart Apply does not do</p>
          <ul className="mt-1 space-y-1 text-xs text-ink-muted">
            <li>Does not auto-submit applications.</li>
            <li>Does not replace your judgment on final answers.</li>
            <li>Does not require every optional field to work.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
