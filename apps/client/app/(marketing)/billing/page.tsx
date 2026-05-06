import type { Metadata } from "next";
import { LegalPageShell } from "../../../components/legal/LegalPageShell";
import { getSupportEmail, LEGAL_LAST_UPDATED } from "../../../lib/siteIdentity";

export const metadata: Metadata = {
  title: "Billing & refunds | JobLoom",
  description: "Subscriptions, cancellation, and refunds for JobLoom Pro.",
};

export default function BillingPage() {
  const support = getSupportEmail();

  return (
    <LegalPageShell
      title="Billing, cancellation, and refunds"
      description={`Last updated: ${LEGAL_LAST_UPDATED}.`}
    >
      <p>
        This page explains how <strong>paid</strong> plans for JobLoom (for example, &quot;Pro&quot; or a similarly named plan)
        work. Your <a href="/terms">Terms of Service</a> and <a href="/privacy">Privacy Policy</a> also apply. More detail on
        charges, tax, and payment support may appear at <strong>checkout</strong> and in documentation from our payment providers{" "}
        <strong>PayPal</strong> and <strong>Dodo Payments</strong> (which may act as <strong>Merchant of Record</strong> for your purchase).
      </p>

      <h2>1. Subscription; billing period</h2>
      <p>
        Paid access is a <strong>subscription</strong> billed in <strong>advance</strong> for the period you select (for example,{" "}
        <strong>monthly</strong> or <strong>annual</strong>). The price, currency, and billing interval are shown before you
        complete payment. Payment is processed by <strong>PayPal</strong> or <strong>Dodo Payments</strong>, not by us directly; your
        bank or card statement may list the provider&apos;s name. The provider may handle invoicing, tax collection, and
        first-line payment questions under its own terms.
      </p>
      <p>
        <strong>Subscriptions renew automatically at the end of each billing period unless you cancel</strong> before the
        renewal date (or, where your payment provider offers a different cut-off, as stated at checkout or in the
        provider&apos;s terms). <strong>Auto-renewal</strong> means a new term is charged without a separate sign-up for each
        period until you cancel.
      </p>

      <h2>2. Cancellation</h2>
      <p>
        You may <strong>cancel at any time</strong> from <strong>Account settings</strong>. <strong>Canceling stops renewal</strong>—it does not retroactively refund the
        current period unless a refund is required by law, offered by the payment provider, or agreed by us in writing.
      </p>
      <p>
        After you cancel, you generally <strong>keep access to paid features until the end of the period you have already
        paid for</strong>. When that period ends, your access moves to the <strong>free tier</strong> limits described on our
        pricing page. If you have trouble locating cancellation controls, contact us using the information below and include
        the email on your account.
      </p>

      <h2>3. Refunds</h2>
      <p>
        <strong>Refund rules depend on</strong> applicable law, the terms shown at <strong>purchase</strong>, and the policies
        of the <strong>third-party payment provider</strong> (including the Merchant of Record, where applicable). We do not
        guarantee a refund for change of mind or partial use of a period. If you were charged in error, you believe a renewal
        was not authorized, or you have a <strong>statutory cooling-off or withdrawal</strong> right in your location, contact
        us promptly with your account email and, if you have one, a transaction or receipt reference. You may also use any
        dispute or support channel offered at checkout. If a refund is issued, <strong>paid access may end</strong> when the
        refund is processed.
      </p>

      <h2>4. Failed payments and grace period</h2>
      <p>
        If a renewal payment fails, your subscription may move into a temporary <strong>past due</strong> grace period while
        we retry collection through PayPal or Dodo Payments. During grace, paid access may remain active. If payment is not
        recovered before grace ends, access moves to the free tier.
      </p>

      <h2>5. Price changes</h2>
      <p>
        We may change prices or plans. Where required by law, we will give <strong>advance notice</strong> and, if you do not
        agree, you may <strong>cancel before the new price applies</strong> to your next renewal.
      </p>

      <h2>6. Taxes</h2>
      <p>Applicable <strong>taxes</strong> may be added to your total as shown at checkout, depending on your location and law.</p>

      <h2>7. Account termination</h2>
      <p>
        We may suspend or terminate the Service for serious breach of our terms or for legal, security, or fraud reasons, as
        described in the <a href="/terms">Terms of Service</a>. You may close your account through available account or
        sign-in settings; <strong>terminating the account</strong> may not by itself delete all personal data; see the{" "}
        <a href="/privacy">Privacy Policy</a> for deletion.
      </p>

      <h2>8. Contact</h2>
      <p>
        Billing and subscription help:{" "}
        {support ? (
          <a href={`mailto:${support}`} className="font-medium text-brand hover:underline">
            {support}
          </a>
        ) : (
          <>the contact method published on this website.</>
        )}
      </p>
    </LegalPageShell>
  );
}
