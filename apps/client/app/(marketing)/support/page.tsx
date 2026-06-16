import type { Metadata } from "next";
import Link from "next/link";
import { DESKTOP_RAIL_INSET_CLASS } from "../../../components/layout/railInset";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { getSupportEmail } from "../../../lib/siteIdentity";

export const metadata: Metadata = {
  title: "Support | JobLoom",
  description: "Get help with JobLoom Smart Apply, autofill, and your account.",
};

const TOPICS = [
  {
    title: "Account & Login",
    description:
      "JobLoom uses secure sign-in through our authentication partner. Use the same account on the website and in the Smart Apply extension.",
    faqs: [
      {
        q: "I cannot sign in or I am stuck in a loop.",
        a: "Try a private window, disable conflicting extensions temporarily, and confirm your browser allows third-party cookies for sign-in. If it persists, email us with a short description of what you see.",
      },
      {
        q: "How do I sign out?",
        a: "Use Account → Sign out on the website. For the extension, sign out from JobLoom in the browser where you installed it so sessions stay in sync.",
      },
    ],
  },
  {
    title: "Smart Apply & Autofill",
    description:
      "Smart Apply runs through the Chrome extension. It detects fields on application pages and fills them using your saved JobLoom profile—you stay in control of what gets submitted.",
    learnMoreHref: "/features/smart-apply",
    faqs: [
      {
        q: "Does Smart Apply submit applications for me?",
        a: "No. Smart Apply assists with filling fields. You should review everything and submit the application yourself.",
      },
      {
        q: "Why do limits or usage messages appear?",
        a: "Plans include daily limits for certain assisted actions. Usage resets on a UTC schedule; see Pricing and your Account for details.",
      },
    ],
  },
  {
    title: "Resume & Profile",
    description:
      "Upload a resume to power matching and Smart Apply. You can refine your apply profile on the Smart Apply page so answers align with how you want to present yourself.",
    faqs: [
      {
        q: "My extracted profile looks wrong.",
        a: "Try re-uploading a cleaner PDF or DOCX and run import again. You can manually edit fields on the Smart Apply page before applying.",
      },
      {
        q: "Where do I update my information?",
        a: "Use Smart Apply on JobLoom for application-focused fields. Account settings handle sign-in and identity through your authentication provider.",
      },
    ],
  },
  {
    title: "Billing & Subscription",
    description:
      "Upgrade or manage your plan from Pricing. For receipts, renewal timing, and refunds policy, see Billing & refunds.",
    faqs: [
      {
        q: "How do I cancel?",
        a: "Open Account settings and use Cancel Subscription. Cancellation stops renewal and keeps access until your current period ends.",
      },
    ],
  },
] as const;

export default function SupportPage() {
  const supportEmail = getSupportEmail();
  const mailtoHref = supportEmail ? `mailto:${supportEmail}` : null;

  return (
    <div className={`min-h-screen bg-canvas pb-24 pt-10 text-ink ${DESKTOP_RAIL_INSET_CLASS}`}>
      <div className="mx-auto w-[90%] max-w-readable px-4">
        <header className="text-center">
          <h1 className="font-display text-3xl font-normal tracking-tight text-ink sm:text-4xl">
            Support
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-ink-muted">
            Get help with JobLoom Smart Apply and your account. For job-search strategy, see our{" "}
            <Link href="/blog" prefetch={false} className="font-medium text-brand hover:underline">
              blog
            </Link>
            —including{" "}
            <Link href="/blog/why-youre-probably-finding-jobs-too-late" prefetch={false} className="font-medium text-brand hover:underline">
              why many roles appear on career sites before LinkedIn
            </Link>
            .
          </p>
        </header>

        <section className="mt-14 rounded-2xl border border-line bg-surface px-5 py-6 shadow-card sm:px-7 sm:py-8">
          <h2 className="font-sans text-xl font-bold text-ink">Contact</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">
            Reach our team directly—we read every message.
          </p>
          {supportEmail && mailtoHref ? (
            <>
              <p className="mt-4">
                <a href={mailtoHref} className="text-sm font-semibold text-brand hover:underline">
                  {supportEmail}
                </a>
              </p>
              <div className="mt-6">
                <Button href={mailtoHref} size="md">
                  Contact Support
                </Button>
              </div>
            </>
          ) : (
            <p className="mt-4 text-sm leading-relaxed text-ink-muted">
              Email contact is not configured for this deployment. Use the topics below and{" "}
              <Link href="/billing" className="font-medium text-brand hover:underline" prefetch={false}>
                Billing &amp; refunds
              </Link>{" "}
              for subscription-related questions.
            </p>
          )}
        </section>

        <section className="mt-16">
          <h2 className="text-center font-sans text-xl font-bold text-ink">Common topics</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-sm leading-relaxed text-ink-muted">
            Quick orientation by area—expand a question when you need more detail.
          </p>
          <div className="mt-10 grid gap-6 sm:grid-cols-2">
            {TOPICS.map((topic) => (
              <Card key={topic.title} accent="brand" className="p-6 sm:p-7">
                <h3 className="font-sans text-lg font-bold text-ink">{topic.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                  {topic.description}
                  {"learnMoreHref" in topic && topic.learnMoreHref ? (
                    <>
                      {" "}
                      <Link
                        href={topic.learnMoreHref}
                        className="font-medium text-brand hover:underline"
                        prefetch={false}
                      >
                        Feature overview →
                      </Link>
                    </>
                  ) : null}
                </p>
                <div className="mt-5 space-y-2 border-t border-line pt-5">
                  {topic.faqs.map(({ q, a }) => (
                    <details
                      key={q}
                      className="group rounded-xl border border-line bg-canvas/60 px-4 py-3 text-left shadow-sm open:bg-surface open:shadow-card"
                    >
                      <summary className="cursor-pointer list-none text-sm font-semibold text-ink outline-none [&::-webkit-details-marker]:hidden">
                        <span className="flex items-start justify-between gap-2">
                          <span>{q}</span>
                          <span className="mt-0.5 shrink-0 text-ink/45 transition group-open:rotate-180">▾</span>
                        </span>
                      </summary>
                      <p className="mt-3 text-sm leading-relaxed text-ink-muted">{a}</p>
                    </details>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </section>

        <section className="mt-16">
          <h2 className="font-sans text-xl font-bold text-ink">Troubleshooting</h2>
          <div className="mt-8 space-y-5">
            <div className="rounded-xl border border-line bg-surface px-5 py-4 shadow-card">
              <h3 className="text-sm font-bold text-ink">Extension not working?</h3>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-muted">
                <li>Confirm the JobLoom Smart Apply extension is installed and enabled in Chrome.</li>
                <li>Refresh the application tab after installing or updating the extension.</li>
                <li>Make sure you are signed into JobLoom in the same browser profile as the extension.</li>
              </ul>
            </div>
            <div className="rounded-xl border border-line bg-surface px-5 py-4 shadow-card">
              <h3 className="text-sm font-bold text-ink">Autofill not detecting fields?</h3>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-muted">
                <li>Some ATS forms load fields inside iframes or shadow DOMs—try clicking into the field first, then run detection again.</li>
                <li>Disable conflicting form-filler extensions temporarily and retry.</li>
                <li>Complete your Smart Apply profile on JobLoom so the extension has structured data to map.</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="mt-16 rounded-xl border border-line bg-surface px-5 py-5 text-center shadow-card sm:px-7">
          <h2 className="font-sans text-lg font-bold text-ink">Response expectations</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-ink-muted">
            We typically respond within 24–48 hours.
          </p>
        </section>

        <p className="mx-auto mt-12 max-w-xl text-center text-xs leading-relaxed text-ink/65">
          For how we handle personal data, see our{" "}
          <Link href="/privacy" className="font-medium text-brand hover:underline" prefetch={false}>
            Privacy Policy
          </Link>
          . Billing questions may also be covered under{" "}
          <Link href="/billing" className="font-medium text-brand hover:underline" prefetch={false}>
            Billing &amp; refunds
          </Link>{" "}
          and{" "}
          <Link href="/pricing" className="font-medium text-brand hover:underline" prefetch={false}>
            Pricing
          </Link>
          .
        </p>

        <p className="mt-8 text-center text-sm">
          <Link href="/jobs" className="font-medium text-brand hover:text-brand-hover hover:underline" prefetch={false}>
            ← Back to jobs
          </Link>
        </p>
      </div>
    </div>
  );
}
