"use client";

import { SignInButton, useAuth } from "@clerk/nextjs";
import { useCallback, useState } from "react";
import { API_BASE_URL } from "../../lib/api";
import { CREAM_TINT, CORAL, PRO_FEATURES } from "./pricingCopy";

const ANNUAL_VARIANT_ID = process.env.NEXT_PUBLIC_LS_PRO_ANNUAL_VARIANT_ID?.trim() ?? "";
const MONTHLY_VARIANT_ID = process.env.NEXT_PUBLIC_LS_PRO_MONTHLY_VARIANT_ID?.trim() ?? "";

type CheckoutKey = "pro_annual" | "pro_monthly";

const VARIANT_BY_KEY: Record<CheckoutKey, string> = {
  pro_annual: ANNUAL_VARIANT_ID,
  pro_monthly: MONTHLY_VARIANT_ID,
};

export function PricingPlansClient() {
  const { isSignedIn, getToken } = useAuth();
  const [busy, setBusy] = useState<null | CheckoutKey>(null);
  const [error, setError] = useState<string | null>(null);

  const startCheckout = useCallback(
    async (which: CheckoutKey) => {
      setError(null);
      const variantId = VARIANT_BY_KEY[which];
      if (!variantId) {
        setError("Pricing is not configured. Add Lemon Squeezy variant IDs to your environment.");
        return;
      }
      setBusy(which);
      try {
        const token = await getToken();
        if (!token) {
          setError("Sign in to continue.");
          setBusy(null);
          return;
        }
        const res = await fetch(`${API_BASE_URL}/billing/create-checkout`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ variantId }),
        });
        const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
        if (!res.ok) {
          setError(data.error ?? "Could not start checkout. Try again.");
          setBusy(null);
          return;
        }
        if (data.url) {
          window.location.assign(data.url);
          return;
        }
        setError("No checkout URL returned.");
      } catch {
        setError("Network error. Check your connection and API URL.");
      } finally {
        setBusy(null);
      }
    },
    [getToken],
  );

  const PlanAction = ({
    which,
    label,
  }: {
    which: CheckoutKey;
    label: string;
  }) => {
    const loading = busy === which;
    const configured = Boolean(VARIANT_BY_KEY[which]);
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
        disabled={loading || !configured}
        onClick={() => void startCheckout(which)}
        className="w-full rounded-xl py-3.5 text-center text-[15px] font-bold text-white transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
        style={{ backgroundColor: CORAL }}
      >
        {loading ? "Redirecting…" : label}
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
              $3.99<span className="text-xl font-bold text-ink-muted">/mo</span>
            </p>
            <p className="mt-2 text-sm text-ink-muted">
              billed <span className="font-semibold text-ink">$47.88/year</span>
            </p>
            <span
              className="mt-2 inline-block rounded-md px-2.5 py-1 text-xs font-bold text-white"
              style={{ backgroundColor: CORAL }}
            >
              SAVE 20%
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
