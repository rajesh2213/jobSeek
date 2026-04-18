import Link from "next/link";
import { getCompanyAddress, getSiteOperator, getSupportEmail } from "../../lib/siteIdentity";

/** Legal links, contact, and operator identity — used on marketing and app layouts. */
export function LegalFooter() {
  const email = getSupportEmail();
  const operator = getSiteOperator();
  const address = getCompanyAddress();
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-ink/10 bg-canvas px-4 py-8 text-sm text-ink/70 sm:px-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-ink/60">
            <span className="font-display text-xl italic text-ink">jobseek</span>
            <span className="h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
            <span>
              © {year} {operator}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm text-ink/65">
            <Link href="/jobs" className="hover:text-brand" prefetch={false}>
              Jobs
            </Link>
            <Link href="/companies" className="hover:text-brand" prefetch={false}>
              Companies
            </Link>
            <Link href="/pricing" className="hover:text-brand" prefetch={false}>
              Pricing
            </Link>
            <Link href="/account" className="hover:text-brand" prefetch={false}>
              Account
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-ink/10 pt-6 text-xs text-ink/60">
          <Link href="/terms" className="hover:text-brand" prefetch={false}>
            Terms of Service
          </Link>
          <Link href="/privacy" className="hover:text-brand" prefetch={false}>
            Privacy Policy
          </Link>
          <Link href="/billing" className="hover:text-brand" prefetch={false}>
            Billing &amp; refunds
          </Link>
          {email ? (
            <a href={`mailto:${email}`} className="hover:text-brand">
              Contact
            </a>
          ) : null}
        </div>
        {address ? <p className="max-w-lg text-xs text-ink/55">{address}</p> : null}
      </div>
    </footer>
  );
}
