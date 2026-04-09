"use client";

import { SignInButton, useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useCallback, useState } from "react";
import { API_BASE_URL } from "../../../lib/api";

const CORAL = "#E8533A";
const CREAM_TINT = "linear-gradient(180deg, rgba(232, 122, 93, 0.08) 0%, rgba(244, 239, 230, 0.5) 100%)";

const ANNUAL_VARIANT_ID = process.env.NEXT_PUBLIC_LS_PRO_ANNUAL_VARIANT_ID?.trim() ?? "";
const MONTHLY_VARIANT_ID = process.env.NEXT_PUBLIC_LS_PRO_MONTHLY_VARIANT_ID?.trim() ?? "";

const PRO_FEATURES = [
  "Unlimited jobs daily",
  "AI resume review",
  "Job alerts",
  "Saved searches",
  "Early access",
] as const;

const FAQ = [
  {
    q: "Can I cancel anytime?",
    a: "Yes. Cancel from your account or billing portal whenever you like. You keep access through the end of the period you already paid for.",
  },
  {
    q: "What happens to my data if I downgrade?",
    a: "Your saved searches and account stay intact. Free limits apply again for daily job views, but nothing is deleted just for downgrading.",
  },
  {
    q: "Is there a free trial?",
    a: "You can explore the product on the free tier first. Pro unlocks unlimited browsing and premium features as soon as you subscribe.",
  },
  {
    q: "How does early access work?",
    a: "Pro members get first access to new JobSeek features and experiments before they roll out to everyone.",
  },
] as const;

export default function PricingPage() {
  const { isSignedIn, getToken } = useAuth();
  const [busy, setBusy] = useState<null | "annual" | "monthly">(null);
  const [error, setError] = useState<string | null>(null);

  const startCheckout = useCallback(
    async (which: "annual" | "monthly") => {
      setError(null);
      const variantId = which === "annual" ? ANNUAL_VARIANT_ID : MONTHLY_VARIANT_ID;
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
    which: "annual" | "monthly";
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
        disabled={loading || (which === "annual" ? !ANNUAL_VARIANT_ID : !MONTHLY_VARIANT_ID)}
        onClick={() => void startCheckout(which)}
        className="w-full rounded-xl py-3.5 text-center text-[15px] font-bold text-white transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
        style={{ backgroundColor: CORAL }}
      >
        {loading ? "Redirecting…" : label}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-canvas pb-20 pt-10">
      <div className="mx-auto w-[90%] max-w-readable px-4">
        <p className="text-center font-display text-3xl font-normal tracking-tight text-ink sm:text-4xl md:text-[2.75rem] md:leading-tight">
          Unlock your full job search potential
        </p>
        <p className="mx-auto mt-4 max-w-2xl text-center text-base leading-relaxed text-ink-muted">
          Join job seekers who get hired faster with unlimited access
        </p>

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
                $3<span className="text-xl font-bold text-ink-muted">/mo</span>
              </p>
              <p className="mt-2 text-sm text-ink-muted">
                billed <span className="font-semibold text-ink">$36/year</span>
              </p>
              <span
                className="mt-2 inline-block rounded-md px-2.5 py-1 text-xs font-bold text-white"
                style={{ backgroundColor: CORAL }}
              >
                SAVE 40%
              </span>
            </div>
            <p className="mt-4 text-sm italic leading-relaxed text-ink/75">
              Less than one coffee for your entire job search
            </p>
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
              <PlanAction which="annual" label="Get Pro Annual →" />
            </div>
          </div>

          <div className="flex flex-col rounded-2xl border border-line bg-surface p-8 shadow-card ring-1 ring-ink/5">
            <h2 className="font-sans text-lg font-bold text-ink">Pro Monthly</h2>
            <p className="mt-1 text-sm text-ink-muted">Flexible month-to-month</p>
            <div className="mt-6">
              <p className="font-sans text-4xl font-extrabold tabular-nums tracking-tight text-ink">
                $5<span className="text-xl font-bold text-ink-muted">/mo</span>
              </p>
              <p className="mt-2 text-sm text-ink-muted">billed monthly</p>
            </div>
            <p className="mt-4 text-sm italic leading-relaxed text-ink/75">
              Less than one coffee for your entire job search
            </p>
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
              <PlanAction which="monthly" label="Get Pro Monthly →" />
            </div>
          </div>
        </div>

        <div className="mx-auto mt-16 max-w-3xl">
          <h3 className="text-center font-sans text-xl font-bold text-ink">Compare plans</h3>
          <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-canvas/80">
                  <th className="px-4 py-3 font-semibold text-ink">Feature</th>
                  <th className="px-4 py-3 font-semibold text-ink">Free</th>
                  <th className="px-4 py-3 font-semibold text-brand">Pro</th>
                </tr>
              </thead>
              <tbody className="text-ink/90">
                <tr className="border-b border-line">
                  <td className="px-4 py-3">Jobs per day</td>
                  <td className="px-4 py-3 text-ink-muted">Limited</td>
                  <td className="px-4 py-3 font-medium text-ink">Unlimited</td>
                </tr>
                <tr className="border-b border-line">
                  <td className="px-4 py-3">AI resume review</td>
                  <td className="px-4 py-3 text-ink-muted">—</td>
                  <td className="px-4 py-3 font-medium text-ink">✓</td>
                </tr>
                <tr className="border-b border-line">
                  <td className="px-4 py-3">Job alerts</td>
                  <td className="px-4 py-3 text-ink-muted">Basic</td>
                  <td className="px-4 py-3 font-medium text-ink">Full</td>
                </tr>
                <tr className="border-b border-line">
                  <td className="px-4 py-3">Saved searches</td>
                  <td className="px-4 py-3 text-ink-muted">Limited</td>
                  <td className="px-4 py-3 font-medium text-ink">Unlimited</td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Early access</td>
                  <td className="px-4 py-3 text-ink-muted">—</td>
                  <td className="px-4 py-3 font-medium text-ink">✓</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mx-auto mt-16 max-w-2xl">
          <h3 className="text-center font-sans text-xl font-bold text-ink">FAQ</h3>
          <dl className="mt-8 space-y-6">
            {FAQ.map(({ q, a }) => (
              <div key={q} className="rounded-xl border border-line bg-surface px-5 py-4 shadow-card">
                <dt className="font-semibold text-ink">{q}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-ink-muted">{a}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="mx-auto mt-12 flex justify-center">
          <div
            className="rounded-full border border-brand/25 px-5 py-2 text-sm font-semibold text-ink"
            style={{ backgroundColor: "rgba(232, 122, 93, 0.12)" }}
          >
            14-day money-back guarantee — love it or get a full refund
          </div>
        </div>

        <p className="mt-10 text-center text-sm text-ink-muted">
          🔒 Secured by Lemon Squeezy · Cancel anytime · No questions asked
        </p>

        <p className="mt-6 text-center text-sm">
          <Link href="/jobs" className="font-medium text-brand hover:text-brand-hover hover:underline">
            ← Back to jobs
          </Link>
        </p>
      </div>
    </div>
  );
}
