import type { Metadata } from "next";
import { LegalPageShell } from "../../../components/legal/LegalPageShell";
import { getSiteOperator, getSupportEmail } from "../../../lib/siteIdentity";

export const metadata: Metadata = {
  title: "Billing & refunds | JobLoom",
  description: "Subscriptions, cancellation, and refunds for JobLoom Pro.",
};

export default function BillingPage() {
  const operator = getSiteOperator();
  const support = getSupportEmail();

  return (
    <LegalPageShell
      title="Billing, cancellation, and refunds"
      description={`Last updated: ${new Date().toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" })}. Template — have qualified counsel review before reliance.`}
    >
      <p>
        This page describes how paid plans for {operator}&apos;s JobLoom product (&quot;Pro&quot; or similar) work at a high level. The
        checkout screen and third-party billing portal may contain additional details.
      </p>

      <h2>1. Subscription</h2>
      <p>
        Pro is a subscription service billed in advance for the interval you choose (for example, monthly or annual). Unless
        stated otherwise at purchase, subscriptions renew automatically until you cancel.
      </p>

      <h2>2. Cancellation</h2>
      <p>
        You can cancel at any time using the account or billing controls we provide (including the payment provider&apos;s customer
        portal where applicable). When you cancel, you generally keep access to paid features until the end of the billing period
        you already paid for. After that, your account moves to the free tier limits described on our pricing page.
      </p>

      <h2>3. Refunds</h2>
      <p>
        Refund eligibility may depend on applicable law, the rules of our payment processor, and what was shown to you at
        checkout. If you believe you were charged in error or have a statutory right of withdrawal in your jurisdiction, contact
        us promptly with your account email and transaction details. Where a refund is granted, access to paid features may end
        when the refund is processed.
      </p>

      <h2>4. Price changes</h2>
      <p>
        We may change prices or plans. Where required, we will give advance notice and, if you do not agree, you may cancel before
        the new price takes effect for your renewal.
      </p>

      <h2>5. Taxes</h2>
      <p>Applicable taxes may be added to your total as shown at checkout, depending on your location and law.</p>

      <h2>6. Contact</h2>
      <p>
        Billing questions:{" "}
        {support ? (
          <a href={`mailto:${support}`} className="font-medium text-brand hover:underline">
            {support}
          </a>
        ) : (
          <>use the contact method published on this website when available.</>
        )}
      </p>
    </LegalPageShell>
  );
}
