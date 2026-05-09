import type { Metadata } from "next";
import Link from "next/link";
import { DESKTOP_RAIL_INSET_CLASS } from "../../../components/layout/railInset";
import { getSiteOperator, getSupportEmail } from "../../../lib/siteIdentity";

export const metadata: Metadata = {
  title: "About | JobLoom",
  description: "What JobLoom is, how job discovery works, and how to get support.",
};

export default function AboutPage() {
  const operator = getSiteOperator();
  const support = getSupportEmail();
  /** Avoid "JobLoom builds JobLoom…" when the legal operator name is the same as the product. */
  const operatorIsProduct =
    operator.trim().toLowerCase() === "jobloom";

  return (
    <div className={`min-h-screen bg-canvas pb-24 pt-10 text-ink ${DESKTOP_RAIL_INSET_CLASS}`}>
      <div className="mx-auto w-[90%] max-w-readable px-4">
        <header>
          <h1 className="font-display text-3xl font-normal tracking-tight text-ink sm:text-4xl">About JobLoom</h1>
          <p className="mt-4 text-base leading-relaxed text-ink-muted">
            {operatorIsProduct ? (
              <>
                JobLoom is a <strong className="font-semibold text-ink">job discovery and organization</strong> product—we
                help you find roles from many sources, prepare applications, and keep track of what you&apos;ve submitted.
              </>
            ) : (
              <>
                {operator} builds JobLoom as a <strong className="font-semibold text-ink">job discovery and organization</strong>{" "}
                product—helping you find roles from many sources, prepare applications, and keep track of what you&apos;ve
                submitted.
              </>
            )}
          </p>
        </header>

        <section className="mt-12 space-y-4 text-sm leading-relaxed text-ink/90">
          <h2 className="font-sans text-lg font-bold text-ink">What we do</h2>
          <p>
            JobLoom aggregates and surfaces job listings from company career sites and other sources we ingest. We focus on
            making search, filtering, and day-to-day workflow easier—not on replacing employers&apos; own application systems.
          </p>
          <p>
            When you apply, you typically complete the process on the <strong>hiring company&apos;s website or ATS</strong>. JobLoom
            may help you prepare (for example resume insights or optional Smart Apply field assistance), but{" "}
            <strong>you decide what to submit</strong>.
          </p>
        </section>

        <section className="mt-10 space-y-4 text-sm leading-relaxed text-ink/90">
          <h2 className="font-sans text-lg font-bold text-ink">What we are not</h2>
          <p>
            We are <strong>not</strong> a recruiting agency or placement service. We do not guarantee interviews, offers, or
            compensation. Hiring decisions belong to employers; market conditions and your fit matter.
          </p>
        </section>

        <section className="mt-10 space-y-4 text-sm leading-relaxed text-ink/90">
          <h2 className="font-sans text-lg font-bold text-ink">Mission</h2>
          <p>
            Reduce friction in job search: less time lost to duplicate posts and scattered tabs, more clarity on what to apply
            to and what to do next.
          </p>
        </section>

        <section className="mt-10 rounded-2xl border border-line bg-surface px-5 py-6 shadow-card sm:px-7">
          <h2 className="font-sans text-lg font-bold text-ink">Contact &amp; policies</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">
            Questions, privacy requests, or billing help: use{" "}
            <Link href="/support" className="font-medium text-brand hover:underline" prefetch={false}>
              Support
            </Link>
            {support ? (
              <>
                {" "}
                or email{" "}
                <a href={`mailto:${support}`} className="font-medium text-brand hover:underline">
                  {support}
                </a>
              </>
            ) : null}
            . Legal terms:{" "}
            <Link href="/terms" className="font-medium text-brand hover:underline" prefetch={false}>
              Terms of Service
            </Link>
            ,{" "}
            <Link href="/privacy" className="font-medium text-brand hover:underline" prefetch={false}>
              Privacy Policy
            </Link>
            .
          </p>
        </section>

        <p className="mt-10 text-center text-sm">
          <Link href="/jobs" className="font-medium text-brand hover:text-brand-hover hover:underline" prefetch={false}>
            ← Browse jobs
          </Link>
        </p>
      </div>
    </div>
  );
}
