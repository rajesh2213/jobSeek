import Link from "next/link";
import { PricingPlansClient } from "../../../components/pricing/PricingPlansClient";
import { FAQ } from "../../../components/pricing/pricingCopy";
import { FREE_DAILY_JOBS, FREE_RESUME_MATCH_AI_PER_24H, PLAN_LIMITS } from "../../../lib/planLimits";

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-canvas pb-20 pt-10">
      <div className="mx-auto w-[90%] max-w-readable px-4">
        <p className="text-center font-display text-3xl font-normal tracking-tight text-ink sm:text-4xl md:text-[2.75rem] md:leading-tight">
          Unlock your full job search potential
        </p>
        <p className="mx-auto mt-4 max-w-2xl text-center text-base leading-relaxed text-ink-muted">
          Unlock unlimited browsing, deeper resume insights, Smart Apply, and email alerts—outcomes still depend on your market and fit.
        </p>

        <PricingPlansClient />

        <p className="mx-auto mt-10 max-w-xl text-center text-sm italic leading-relaxed text-ink/75">
          Less than one coffee a month for your entire job search.
        </p>

        <div className="mx-auto mt-16 max-w-5xl overflow-x-auto">
          <h3 className="text-center font-sans text-xl font-bold text-ink">Compare plans</h3>
          <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
            <table className="w-full min-w-[480px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-canvas/80">
                  <th className="px-4 py-3 font-semibold text-ink">Feature</th>
                  <th className="px-4 py-3 font-semibold text-ink">Free</th>
                  <th className="px-4 py-3 font-semibold text-brand">Pro</th>
                </tr>
              </thead>
              <tbody className="text-ink/90">
                <tr className="border-b border-line">
                  <td className="px-4 py-3">Explore jobs</td>
                  <td className="px-4 py-3 text-ink-muted">
                    {`${FREE_DAILY_JOBS} jobs per day`}
                  </td>
                  <td className="px-4 py-3 font-medium text-ink">Unlimited</td>
                </tr>
                <tr className="border-b border-line">
                  <td className="px-4 py-3">Smart Apply — field auto-fill</td>
                  <td className="px-4 py-3 text-ink-muted">—</td>
                  <td className="px-4 py-3 font-medium text-ink">Unlimited (extension)</td>
                </tr>
                <tr className="border-b border-line">
                  <td className="px-4 py-3">Smart Apply — AI open-ended answers</td>
                  <td className="px-4 py-3 text-ink-muted">—</td>
                  <td className="px-4 py-3 font-medium text-ink">
                    {PLAN_LIMITS.pro.smartApplyJobs} job applications/day (UTC)
                  </td>
                </tr>
                <tr className="border-b border-line">
                  <td className="px-4 py-3">AI resume match</td>
                  <td className="px-4 py-3 text-ink-muted">
                    Overall score · up to {FREE_RESUME_MATCH_AI_PER_24H} per rolling 24h
                  </td>
                  <td className="px-4 py-3 font-medium text-ink">Unlimited + full gap analysis</td>
                </tr>
                <tr className="border-b border-line">
                  <td className="px-4 py-3">Saved searches</td>
                  <td className="px-4 py-3 font-medium text-ink">3</td>
                  <td className="px-4 py-3 font-medium text-ink">3</td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Email job alerts</td>
                  <td className="px-4 py-3 text-ink-muted">—</td>
                  <td className="px-4 py-3 font-medium text-ink">✓</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-3 text-center text-xs text-ink/55">
              Job browse limits reset at midnight UTC. Free AI resume match uses a rolling 24-hour window (see Free
              column).
            </p>
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

        <p className="mx-auto mt-12 text-center text-sm text-ink-muted">
          Secure checkout via PayPal or Dodo Payments · Cancel anytime from Account settings
        </p>
        <p className="mx-auto mt-4 max-w-xl text-center text-xs leading-relaxed text-ink/65">
          By subscribing you agree to our{" "}
          <Link href="/terms" className="font-medium text-brand hover:underline">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="font-medium text-brand hover:underline">
            Privacy Policy
          </Link>
          . See{" "}
          <Link href="/billing" className="font-medium text-brand hover:underline">
            Billing &amp; refunds
          </Link>{" "}
          for cancellation details.
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
