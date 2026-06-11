"use client";

import { SignInButton, useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { trackUpgradePromptShown } from "../../lib/analytics/upgradeFunnel";
import { useAccountPlan } from "../../lib/useAccountPlan";
import { useProCheckout, type CheckoutKey } from "../../lib/useProCheckout";
import {
  parseUpgradeFromParam,
  pricingUrl,
  UPGRADE_TRIGGER_COPY,
} from "../../lib/upgradeTriggers";
import {
  PRO_ANNUAL_BILLED_YEAR_LABEL,
  PRO_ANNUAL_SAVE_VS_MONTHLY_PERCENT,
  PRO_ANNUAL_USD_PER_MONTH,
} from "../../lib/pricingDisplay";
import { CREAM_TINT, CORAL, PRO_FEATURES } from "./pricingCopy";

export function PricingPlansClient() {
  const { isSignedIn } = useAuth();
  const searchParams = useSearchParams();
  const fromParam = parseUpgradeFromParam(searchParams.get("from"));
  const { isPro, pendingUpgrade, markPendingUpgrade, refresh, clearPendingUpgrade } = useAccountPlan();
  const {
    busyPayPal,
    busyDodo,
    error,
    startPayPalCheckout,
    startDodoCheckout,
    closeDodoCheckoutAndReset,
  } = useProCheckout({ trigger: fromParam, surface: "pricing_banner" });
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (fromParam !== "unknown") {
      trackUpgradePromptShown({
        trigger: fromParam,
        surface: "pricing_banner",
        from: fromParam,
      });
    }
  }, [fromParam]);

  useEffect(() => {
    const paypal = searchParams.get("paypal");
    const dodo = searchParams.get("dodo");
    const checkoutReturned = paypal === "return" || dodo === "return";
    const checkoutCanceled = paypal === "cancel" || dodo === "cancel";
    if (checkoutReturned) {
      markPendingUpgrade();
      setStatusMessage("Payment received. Activating your subscription...");
      return;
    }
    if (checkoutCanceled) {
      clearPendingUpgrade();
      setStatusMessage("Checkout canceled. No changes were made to your subscription.");
      return;
    }
    setStatusMessage(null);
  }, [clearPendingUpgrade, markPendingUpgrade, searchParams]);

  const contextBanner =
    fromParam !== "unknown" ? UPGRADE_TRIGGER_COPY[fromParam].pricingBanner : null;

  const PlanActions = ({ which }: { which: CheckoutKey }) => {
    const loadingPayPal = busyPayPal === which;
    const loadingDodo = busyDodo === which;
    const waiting = pendingUpgrade && !isPro;
    const disabled = waiting || loadingPayPal || loadingDodo;

    if (!isSignedIn) {
      return (
        <SignInButton mode="modal" forceRedirectUrl="/pricing">
          <button
            type="button"
            className="w-full rounded-xl py-3.5 text-center text-[15px] font-bold text-white transition-opacity hover:opacity-95 disabled:opacity-60"
            style={{ backgroundColor: CORAL }}
          >
            Sign in to upgrade
          </button>
        </SignInButton>
      );
    }

    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => void startPayPalCheckout(which)}
          className="w-full rounded-xl py-3.5 text-center text-[15px] font-bold text-white transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
          style={{ backgroundColor: CORAL }}
        >
          {waiting ? "Processing payment…" : loadingPayPal ? "Redirecting…" : "Pay with PayPal"}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void startDodoCheckout(which)}
          className="w-full rounded-xl border-2 border-ink/20 bg-surface py-3.5 text-center text-[15px] font-bold text-ink transition-opacity hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {waiting ? "Processing payment…" : loadingDodo ? "Opening checkout…" : "Pay with Card"}
        </button>
      </div>
    );
  };

  return (
    <>
      {contextBanner ? (
        <p className="mx-auto mt-6 max-w-lg rounded-xl border border-brand/25 bg-brand/5 px-4 py-3 text-center text-sm font-medium text-ink">
          {contextBanner}
        </p>
      ) : null}
      {error ? (
        <p
          className="mx-auto mt-6 max-w-lg rounded-xl border border-rose/30 bg-rose-soft px-4 py-3 text-center text-sm text-ink"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {statusMessage ? (
        <p className="mx-auto mt-6 max-w-lg rounded-xl border border-line bg-surface px-4 py-3 text-center text-sm text-ink">
          {statusMessage}
        </p>
      ) : null}
      {pendingUpgrade && !isPro ? (
        <div
          className="mx-auto mt-8 max-w-md rounded-2xl border border-line bg-surface px-6 py-5 shadow-card ring-1 ring-ink/5"
          role="status"
        >
          <p className="text-center font-sans text-base font-semibold text-ink">Confirming your upgrade</p>
          <p className="mt-2 text-center text-sm leading-relaxed text-ink-muted">
            We are waiting for your payment provider webhook confirmation. This usually takes a few seconds.
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-xl border-2 border-brand bg-brand px-4 py-2.5 text-center text-sm font-semibold text-white transition-opacity hover:opacity-95"
            >
              Refresh status
            </button>
            <button
              type="button"
              onClick={closeDodoCheckoutAndReset}
              className="rounded-xl border border-line bg-surface px-4 py-2.5 text-center text-sm font-semibold text-ink transition-colors hover:bg-ink/[0.04]"
            >
              Close checkout and cancel
            </button>
          </div>
          <p className="mt-4 text-center text-xs leading-relaxed text-ink-muted">
            If you closed the payment popup or the timer keeps running, tap <span className="font-medium text-ink">Close checkout and cancel</span> to
            tear down the session and unlock these buttons. After a successful payment, keep this open—we will confirm automatically (or use Refresh
            status).
          </p>
        </div>
      ) : null}
      {isPro ? (
        <p className="mx-auto mt-6 max-w-lg rounded-xl border border-emerald-300/60 bg-emerald-50 px-4 py-3 text-center text-sm text-emerald-900">
          Your Pro plan is active.
        </p>
      ) : null}

      <div className="mx-auto mt-12 grid max-w-4xl gap-6 md:grid-cols-2 md:gap-8">
        <div
          className="relative flex flex-col rounded-2xl border-2 border-brand bg-surface p-8 shadow-card ring-1 ring-brand/15"
          style={{ backgroundImage: CREAM_TINT }}
        >
          <span
            className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-4 py-1 text-[11px] font-bold uppercase tracking-wider text-white shadow-sm"
            style={{ backgroundColor: CORAL }}
          >
            Most popular
          </span>
          <h2 className="mt-4 font-sans text-lg font-bold text-ink">Pro Annual</h2>
          <p className="mt-1 text-sm text-ink-muted">Best value for serious searchers</p>
          <div className="mt-6">
            <p className="font-sans text-4xl font-extrabold tabular-nums tracking-tight text-ink">
              ${PRO_ANNUAL_USD_PER_MONTH.toFixed(2)}
              <span className="text-xl font-bold text-ink-muted">/mo</span>
            </p>
            <p className="mt-2 text-sm text-ink-muted">
              billed <span className="font-semibold text-ink">{PRO_ANNUAL_BILLED_YEAR_LABEL}</span>
            </p>
            <span
              className="mt-2 inline-block rounded-md px-2.5 py-1 text-xs font-bold text-white"
              style={{ backgroundColor: CORAL }}
            >
              SAVE {PRO_ANNUAL_SAVE_VS_MONTHLY_PERCENT}%
            </span>
          </div>
          <ul className="mt-6 flex flex-1 flex-col gap-3 text-sm text-ink">
            {PRO_FEATURES.map((f) => (
              <li key={f} className="flex gap-2">
                <span className="font-bold text-brand" aria-hidden>
                  ✓
                </span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <div className="mt-8">
            <PlanActions which="pro_annual" />
          </div>
        </div>

        <div className="flex flex-col rounded-2xl border border-line bg-surface p-8 shadow-card ring-1 ring-ink/5">
          <h2 className="font-sans text-lg font-bold text-ink">Pro Monthly</h2>
          <p className="mt-1 text-sm text-ink-muted">Flexible month-to-month</p>
          <div className="mt-6">
            <p className="font-sans text-4xl font-extrabold tabular-nums tracking-tight text-ink">
              $4.99<span className="text-xl font-bold text-ink-muted">/mo</span>
            </p>
            <p className="mt-2 text-sm text-ink-muted">billed monthly</p>
          </div>
          <ul className="mt-6 flex flex-1 flex-col gap-3 text-sm text-ink">
            {PRO_FEATURES.map((f) => (
              <li key={f} className="flex gap-2">
                <span className="font-bold text-brand" aria-hidden>
                  ✓
                </span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <div className="mt-8">
            <PlanActions which="pro_monthly" />
          </div>
        </div>
      </div>
    </>
  );
}
