"use client";

import { SignInButton, useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useCallback, useEffect } from "react";
import {
  trackUpgradePromptClick,
  trackUpgradePromptShown,
  type UpgradeTrigger,
} from "../../lib/analytics/upgradeFunnel";
import { cn } from "../../lib/cn";
import {
  PRO_ANNUAL_BILLED_YEAR_LABEL,
  PRO_ANNUAL_SAVE_VS_MONTHLY_PERCENT,
  PRO_ANNUAL_USD_PER_MONTH,
} from "../../lib/pricingDisplay";
import { useProCheckout } from "../../lib/useProCheckout";
import {
  dismissUpgradePrompt,
  headlineForTrigger,
  pricingUrl,
  UPGRADE_TRIGGER_COPY,
} from "../../lib/upgradeTriggers";
import { useAccountPlan } from "../../lib/useAccountPlan";
import { CORAL } from "../pricing/pricingCopy";

export type UpgradeDrawerContext = {
  nHidden?: number;
};

type Props = {
  open: boolean;
  trigger: UpgradeTrigger;
  context?: UpgradeDrawerContext;
  onClose: () => void;
};

export function UpgradeDrawer({ open, trigger, context, onClose }: Props) {
  const { isSignedIn } = useAuth();
  const { isPro, pendingUpgrade } = useAccountPlan();
  const { busyPayPal, busyDodo, error, startPayPalCheckout, startDodoCheckout } = useProCheckout({
    trigger,
    surface: "drawer",
  });

  const copy = UPGRADE_TRIGGER_COPY[trigger] ?? UPGRADE_TRIGGER_COPY.unknown;
  const headline = headlineForTrigger(trigger, context);
  const waiting = pendingUpgrade && !isPro;
  const loadingAnnual = busyPayPal === "pro_annual" || busyDodo === "pro_annual";
  const loadingMonthly = busyPayPal === "pro_monthly" || busyDodo === "pro_monthly";
  const disabled = waiting || loadingAnnual || loadingMonthly;

  useEffect(() => {
    if (!open) return;
    trackUpgradePromptShown({ trigger, surface: "drawer" });
  }, [open, trigger]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    document.documentElement.classList.add("overflow-hidden");
    return () => {
      document.documentElement.classList.remove("overflow-hidden");
    };
  }, [open]);

  const handleDismiss = useCallback(() => {
    dismissUpgradePrompt(trigger);
    onClose();
  }, [onClose, trigger]);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Close upgrade prompt"
        className="fixed inset-0 z-[120] bg-black/40"
        onClick={handleDismiss}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="upgrade-drawer-title"
        className="fixed inset-x-0 bottom-0 z-[121] mx-auto max-h-[min(92dvh,640px)] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-ink/10 bg-canvas px-5 pb-8 pt-5 shadow-2xl sm:px-6"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-ink/15" aria-hidden />
        <h2 id="upgrade-drawer-title" className="font-sans text-xl font-bold tracking-tight text-ink">
          {headline}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink/70">{copy.subcopy}</p>

        <ul className="mt-5 space-y-2.5" aria-label="Pro benefits">
          {copy.bullets.map((line) => (
            <li key={line} className="flex items-start gap-2 text-sm text-ink/85">
              <span className="mt-0.5 font-bold text-brand" aria-hidden>
                ✓
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <div className="mt-6 rounded-xl border border-brand/20 bg-surface p-4 ring-1 ring-brand/10">
          <p className="text-xs font-bold uppercase tracking-wide text-brand">Most popular</p>
          <p className="mt-1 font-sans text-2xl font-extrabold tabular-nums text-ink">
            ${PRO_ANNUAL_USD_PER_MONTH.toFixed(2)}
            <span className="text-base font-bold text-ink-muted">/mo</span>
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            Billed {PRO_ANNUAL_BILLED_YEAR_LABEL} · save {PRO_ANNUAL_SAVE_VS_MONTHLY_PERCENT}%
          </p>
        </div>

        {error ? (
          <p className="mt-4 rounded-lg border border-rose/30 bg-rose-soft px-3 py-2 text-sm text-ink" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col gap-2">
          {!isSignedIn ? (
            <SignInButton mode="modal" forceRedirectUrl={pricingUrl(trigger)}>
              <button
                type="button"
                className="w-full rounded-xl py-3.5 text-center text-[15px] font-bold text-white"
                style={{ backgroundColor: CORAL }}
                onClick={() =>
                  trackUpgradePromptClick({
                    trigger,
                    surface: "drawer",
                    cta_type: "drawer_primary",
                  })
                }
              >
                Sign in to start Pro Annual
              </button>
            </SignInButton>
          ) : (
            <>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  trackUpgradePromptClick({
                    trigger,
                    surface: "drawer",
                    cta_type: "drawer_primary",
                  });
                  void startPayPalCheckout("pro_annual");
                }}
                className={cn(
                  "w-full rounded-xl py-3.5 text-center text-[15px] font-bold text-white transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60",
                )}
                style={{ backgroundColor: CORAL }}
              >
                {waiting
                  ? "Processing payment…"
                  : loadingAnnual
                    ? "Starting checkout…"
                    : "Start Pro Annual — PayPal"}
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  trackUpgradePromptClick({
                    trigger,
                    surface: "drawer",
                    cta_type: "drawer_primary",
                  });
                  void startDodoCheckout("pro_annual");
                }}
                className="w-full rounded-xl border-2 border-ink/20 bg-surface py-3.5 text-center text-[15px] font-bold text-ink transition-opacity hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {waiting
                  ? "Processing payment…"
                  : loadingAnnual
                    ? "Opening checkout…"
                    : "Start Pro Annual — Card"}
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  trackUpgradePromptClick({
                    trigger,
                    surface: "drawer",
                    cta_type: "drawer_monthly",
                  });
                  void startPayPalCheckout("pro_monthly");
                }}
                className="text-center text-sm font-semibold text-ink/70 underline-offset-2 hover:text-brand hover:underline disabled:opacity-50"
              >
                {loadingMonthly ? "Starting monthly checkout…" : "Pay monthly instead"}
              </button>
            </>
          )}
          <Link
            href={pricingUrl(trigger)}
            onClick={() =>
              trackUpgradePromptClick({
                trigger,
                surface: "drawer",
                cta_type: "drawer_secondary",
              })
            }
            className="text-center text-sm font-semibold text-brand no-underline hover:underline"
          >
            Compare all plans →
          </Link>
          <button
            type="button"
            onClick={handleDismiss}
            className="mt-1 text-center text-sm font-medium text-ink/50 hover:text-ink/70"
          >
            Not now
          </button>
        </div>
      </div>
    </>
  );
}
