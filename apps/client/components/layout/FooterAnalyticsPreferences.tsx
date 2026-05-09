"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ANALYTICS_CONSENT_STORAGE_KEY,
  getAnalyticsConsentStorage,
  setAnalyticsConsent,
} from "../../lib/analytics/config";

/** Lightweight opt-out control; aligns with Privacy Policy. Pixel script may still load until a gated bootstrap is added. */
export function FooterAnalyticsPreferences() {
  const [hydrated, setHydrated] = useState(false);
  const [allowed, setAllowed] = useState(true);

  useEffect(() => {
    setHydrated(true);
    setAllowed(getAnalyticsConsentStorage() !== "denied");
  }, []);

  if (!hydrated) {
    return <div className="h-14 max-w-md rounded border border-ink/5 bg-ink/[0.02]" aria-hidden />;
  }

  return (
    <div className="mt-6 max-w-xl border-t border-ink/10 pt-5 text-xs text-ink/60">
      <p className="text-[11px] font-bold uppercase tracking-wide text-ink/45">Analytics preferences</p>
      <label className="mt-2 flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-ink/25 text-brand"
          checked={allowed}
          onChange={(e) => {
            const next = e.target.checked;
            setAnalyticsConsent(next);
            setAllowed(next);
          }}
        />
        <span>
          Allow optional marketing measurement (for example Meta Pixel / related events). Uncheck to set{" "}
          <code className="rounded bg-ink/[0.06] px-1 py-px text-[11px]">{ANALYTICS_CONSENT_STORAGE_KEY}</code> in this
          browser.
        </span>
      </label>
      <p className="mt-2 leading-relaxed text-ink/55">
        <strong className="text-ink/65">Refresh the page</strong> after changing this so behavior stays consistent. Details:{" "}
        <Link href="/privacy#analytics-preferences" className="font-medium text-brand hover:underline" prefetch={false}>
          Privacy Policy → Analytics
        </Link>
        .
      </p>
    </div>
  );
}
