"use client";

import { SignInButton, useAuth } from "@clerk/nextjs";
import { useCallback, useState } from "react";
import { API_BASE_URL } from "../../lib/api";
import { useAccountPlan } from "../../lib/useAccountPlan";
import {
  PRO_ANNUAL_BILLED_YEAR_LABEL,
  PRO_ANNUAL_SAVE_VS_MONTHLY_PERCENT,
  PRO_ANNUAL_USD_PER_MONTH,
} from "../../lib/pricingDisplay";
import { CREAM_TINT, CORAL, PRO_FEATURES } from "./pricingCopy";

type CheckoutKey = "pro_annual" | "pro_monthly";

const PLAN_TYPE_BY_KEY: Record<CheckoutKey, "monthly" | "yearly"> = {
  pro_annual: "yearly",
  pro_monthly: "monthly",
};

export function PricingPlansClient() {
  const { isSignedIn, getToken } = useAuth();
  const { isPro, pendingUpgrade, markPendingUpgrade, refresh, clearPendingUpgrade } = useAccountPlan();
  const [busy, setBusy] = useState<null | CheckoutKey>(null);
  const [error, setError] = useState<string | null>(null);

  const startCheckout = useCallback(
    async (which: CheckoutKey) => {
      setError(null);
      setBusy(which);
      try {
        const token = await getToken();
        if (!token) {
          setError("Sign in to continue.");
          setBusy(null);
          return;
        }
        const res = await fetch(`${API_BASE_URL}/billing/paypal/create-subscription`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ planType: PLAN_TYPE_BY_KEY[which] }),
        });
        const data = (await res.json().catch(() => ({}))) as { approvalUrl?: string; error?: string };
        if (!res.ok) {
          setError(data.error ?? "Could not start checkout. Try again.");
          setBusy(null);
          return;
        }
        if (data.approvalUrl) {
          markPendingUpgrade();
          window.location.assign(data.approvalUrl);
          return;
        }
        setError("No approval URL returned.");
      } catch {
        setError("Network error. Check your connection and API URL.");
      } finally {
        setBusy(null);
      }
    },
    [getToken, markPendingUpgrade],
  );

  const PlanAction = ({
    which,
    label,
  }: {
    which: CheckoutKey;
    label: string;
  }) => {
    const loading = busy === which;
    if (!isSignedIn) {
      return (
        <SignInButton mode="modal" forceRedirectUrl="/pricing">
          <button
            type="button"
            className="w-full rounded-xl py-3.5 text-center text-[15px] font-bold text-white transition-opacity hover:opacity-95 disabled:opacity-60"
            style={{ backgroundColor: CORAL }}
          >
            {label}
          </button>
        </SignInButton>
      );
    }
    return (
      <button
        type="button"
        disabled={loading || (pendingUpgrade && !isPro)}
        onClick={() => void startCheckout(which)}
        className="w-full rounded-xl py-3.5 text-center text-[15px] font-bold text-white transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
        style={{ backgroundColor: CORAL }}
      >
        {loading ? "Redirecting…" : pendingUpgrade && !isPro ? "Processing payment…" : label}
      </button>
    );
  };

  return (
    <>
      {error ? (
        <p
          className="mx-auto mt-6 max-w-lg rounded-xl border border-rose/30 bg-rose-soft px-4 py-3 text-center text-sm text-ink"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {pendingUpgrade && !isPro ? (
        <div className="mx-auto mt-6 max-w-lg rounded-xl border border-brand/30 bg-brand/5 px-4 py-3 text-center text-sm text-ink">
          <p>Payment submitted. We are confirming your subscription now.</p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-md border border-brand px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/10"
            >
              Refresh status
            </button>
            <button
              type="button"
              onClick={() => clearPendingUpgrade()}
              className="rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-ink/5"
            >
              Stuck? Reset checkout
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            If confirmation takes more than about a minute, we stop blocking checkout automatically.
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
            <PlanAction which="pro_annual" label="Get Pro Annual →" />
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
            <PlanAction which="pro_monthly" label="Get Pro Monthly →" />
          </div>
        </div>
      </div>
    </>
  );
}
