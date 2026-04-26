import type { Metadata } from "next";
import { LegalPageShell } from "../../../components/legal/LegalPageShell";
import { getSupportEmail, LEGAL_LAST_UPDATED } from "../../../lib/siteIdentity";

export const metadata: Metadata = {
  title: "Privacy Policy | JobLoom",
  description: "How JobLoom collects, uses, and shares personal information.",
};

export default function PrivacyPage() {
  const support = getSupportEmail();

  return (
    <LegalPageShell
      title="Privacy Policy"
      description={`Last updated: ${LEGAL_LAST_UPDATED}.`}
    >
      <p>
        This Privacy Policy describes how JobLoom (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) collects, uses, and
        shares information when you use JobLoom websites, applications, and related services (the &quot;Service&quot;).
      </p>

      <h2>1. Information we collect</h2>
      <h3>Account and authentication</h3>
      <p>
        We use third-party authentication providers to manage sign-in. They may process your email address, identifiers, and
        session data under their own policies. We receive the information we need to create and secure your account.
      </p>
      <h3>Profile and resume data</h3>
      <p>
        If you upload a resume or enter profile information, we store and process that content to provide search, optional
        matching, and application-assistance features. This may include extracted text, structured fields, and derived data
        (such as features used to compare your materials with job descriptions). We do not use this to guarantee employment
        or financial outcomes.
      </p>
      <h3>Usage and device data</h3>
      <p>
        We may collect technical information such as IP address, browser type, approximate location derived from IP, timestamps,
        and diagnostic logs to secure the Service, enforce plan limits, and troubleshoot issues.
      </p>
      <h3>Communications</h3>
      <p>
        If you contact support or enable emails such as job alerts, we process your messages, preferences, and delivery
        metadata.
      </p>
      <h3>Payments</h3>
      <p>
        <strong>We do not store your full card number or other complete payment method details on our systems.</strong>{" "}
        Payments for subscriptions are processed by a <strong>third-party payment provider</strong> that may act as the{" "}
        <strong>Merchant of Record</strong>. The provider handles payment data, charge authorization, and related records in
        line with its own terms and privacy policy. <strong>We receive limited billing metadata</strong> (such as subscription
        status, product or plan identifier, and transaction or customer references) needed to provide access to paid
        features. <strong>How the provider uses payment data is described in the provider&apos;s privacy policy and checkout
        materials.</strong> For subscription management, tax lines, and some refund or billing questions, the provider may be
        your first point of contact under its policies.
      </p>

      <h2>2. How we use information</h2>
      <ul>
        <li>Provide, maintain, and improve the Service.</li>
        <li>Authenticate users and enforce free and paid plan limits.</li>
        <li>Provide resume- and job-related insights and optional AI-assisted text when you use those features.</li>
        <li>Send transactional messages, job alerts you configure, and service announcements.</li>
        <li>Detect abuse, fraud, and security incidents.</li>
        <li>Comply with legal obligations.</li>
      </ul>

      <h2>3. Smart Apply browser extension</h2>
      <p>
        The optional Smart Apply extension may request permission to access pages you visit so it can detect application forms
        and help fill fields using your JobLoom profile. <strong>You choose when to use it and what to submit.</strong> Data
        needed for autofill may be read from the page context and sent to our servers to generate suggestions; we design flows
        to limit what is transmitted. Review the extension permissions in your browser and our <a href="/terms">Terms of
        Service</a> for acceptable use.
      </p>

      <h2>4. Cookies and similar technologies</h2>
      <p>
        We use cookies and similar technologies that are essential for authentication, security, and basic functionality. If we
        introduce non-essential analytics or marketing technologies, we will update this policy and, where required, provide
        appropriate choices.
      </p>

      <h2>5. Sharing of information</h2>
      <p>We may share information with:</p>
      <ul>
        <li>
          <strong>Service providers</strong> who host infrastructure, send email, process payments, or support sign-in, subject
          to contractual obligations.
        </li>
        <li>
          <strong>Legal and safety</strong> recipients when required by law or to protect rights, safety, and integrity of
          users and the Service.
        </li>
        <li>
          <strong>Business transfers</strong> in connection with a merger, acquisition, or sale of assets, with notice where
          required.
        </li>
      </ul>
      <p>We do not sell your personal information for money in the way that term is commonly understood in U.S. state laws.</p>

      <h2>6. Retention; deletion</h2>
      <p>
        We retain information for as long as your account is active and as needed to provide the Service, comply with law,
        resolve disputes, and enforce our agreements. You may request deletion of your account or your personal data by
        following the options in your account (including profile or sign-in account settings) or by contacting us at the
        address below, subject to legal exceptions. Some residual data may remain in encrypted backups for a limited period, or
        where we have a valid legal or security reason to retain it.
      </p>

      <h2>7. Security</h2>
      <p>
        We implement technical and organizational measures designed to protect information. No method of transmission or
        storage is completely secure.
      </p>

      <h2>8. International users</h2>
      <p>
        If you access the Service from outside the country where we or our providers process data, your information may be
        processed in other countries with different privacy laws. Where required, we provide appropriate safeguards or choices.
      </p>
      <p>
        Residents of the European Economic Area, United Kingdom, and certain other regions may have additional rights (such
        as access, correction, deletion, restriction, portability, and objection). Contact us to exercise those rights
        where applicable.
      </p>

      <h2>9. Children</h2>
      <p>
        The Service is not directed to children under 16 (or the age required in your jurisdiction). We do not knowingly
        collect their personal information.
      </p>

      <h2>10. Changes to this policy</h2>
      <p>We may update this Privacy Policy. We will post the revised version and update the &quot;Last updated&quot; date.</p>

      <h2>11. Contact</h2>
      <p>
        Privacy and data rights requests:{" "}
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
