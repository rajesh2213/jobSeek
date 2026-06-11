"use client";

import Link from "next/link";
import { SignInButton, useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { trackUpgradePromptClick } from "../../lib/analytics/upgradeFunnel";
import { cn } from "../../lib/cn";
import { FREE_DISCOVERY } from "../../lib/planLimits";
import { pricingUrl } from "../../lib/upgradeTriggers";
import { useAccountPlan } from "../../lib/useAccountPlan";
import {
  formatUserLocalResetDateTime,
  getUserLocalTimeZoneLabel,
} from "../../lib/userLocalResetTime";

function ResetLine({ resetAt }: { resetAt: string }) {
  const [{ resetDateTime, resetTz }, setSnapshot] = useState({
    resetDateTime: "",
    resetTz: "",
  });

  useEffect(() => {
    setSnapshot({
      resetDateTime: formatUserLocalResetDateTime(resetAt),
      resetTz: getUserLocalTimeZoneLabel(resetAt),
    });
  }, [resetAt]);

  return (
    <>
      <p className="text-[9px] font-semibold uppercase tracking-wide text-ink/45">
        Resets
        {resetTz ? <span className="normal-case"> ({resetTz})</span> : null}
      </p>
      <p className="text-[10px] font-bold leading-snug text-ink/70">{resetDateTime || "\u00a0"}</p>
    </>
  );
}

/**
 * Free-tier browse meter fixed under the desktop side rail — links to upgrade.
 */
export function SidebarBrowseQuotaCard() {
  const { isSignedIn } = useAuth();
  const { isPro, isLoaded, browseQuota } = useAccountPlan();

  if (!isLoaded || isPro) return null;

  const shell = cn(
    "pointer-events-auto fixed bottom-6 left-2 z-[66] hidden w-[104px] flex-col gap-2 rounded-xl border border-ink/[0.08]",
    "bg-gradient-to-br from-white via-[#fffaf8] to-[#f3f0ea] p-2.5 shadow-md ring-1 ring-black/[0.04] lg:flex",
    "transition-[width] duration-200 hover:w-[148px]",
  );

  if (!isSignedIn) {
    return (
      <div className={shell}>
        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-ink/40">Free</p>
        <p className="text-[10px] font-medium leading-snug text-ink/65">
          Sign in to see your daily browse quota.
        </p>
        <SignInButton mode="modal" forceRedirectUrl="/jobs">
          <button
            type="button"
            className="mt-0.5 w-full rounded-lg bg-brand/10 px-2 py-1.5 text-[10px] font-bold text-brand hover:bg-brand/15"
          >
            Sign in
          </button>
        </SignInButton>
      </div>
    );
  }

  if (!browseQuota) return null;

  const { remaining, limit, resetAt } = browseQuota;

  return (
    <Link
      href={pricingUrl("browse_nearing")}
      prefetch={false}
      onClick={() =>
        trackUpgradePromptClick({
          trigger: "browse_nearing",
          surface: "inline",
          cta_type: "inline",
        })
      }
      className={cn(shell, "no-underline hover:border-brand/25 hover:shadow-lg")}
      aria-label="Upgrade for unlimited browsing"
    >
      <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-ink/40">Free</p>
      <div className="space-y-1.5">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-wide text-ink/45">
            Browse quota left today
          </p>
          <p className="text-[11px] font-bold tabular-nums leading-tight text-ink">
            <span className="text-brand">{remaining}</span>
            <span className="text-ink/45"> of </span>
            {limit}
            <span className="text-ink/35"> remaining</span>
          </p>
        </div>
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-wide text-ink/45">Then</p>
          <p className="text-[10px] font-bold text-ink/80">
            {FREE_DISCOVERY.previewRows} preview
          </p>
        </div>
        <ResetLine resetAt={resetAt} />
      </div>
      <p className="text-[10px] font-bold text-brand">Upgrade →</p>
    </Link>
  );
}
