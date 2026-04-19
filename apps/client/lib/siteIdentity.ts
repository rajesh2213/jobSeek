/**
 * Public site identity for footers and legal pages.
 * Set NEXT_PUBLIC_* values in production; fallbacks keep the UI usable in dev.
 */

export function getSiteOperator(): string {
  return process.env.NEXT_PUBLIC_COMPANY_LEGAL_NAME?.trim() || "JobLoom";
}

/** Support contact email, or null if unset (LegalFooter hides mailto link). */
export function getSupportEmail(): string | null {
  const e = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim();
  return e || null;
}

export function getCompanyAddress(): string | null {
  const a = process.env.NEXT_PUBLIC_COMPANY_ADDRESS?.trim();
  return a || null;
}

/** Shown in Privacy (payment processor label). */
export function getPaymentProviderName(): string {
  return process.env.NEXT_PUBLIC_PAYMENT_PROVIDER_NAME?.trim() || "our payment processor";
}

/** Governing law jurisdiction label for Terms (review with counsel). */
export function getGoverningLawJurisdiction(): string {
  return process.env.NEXT_PUBLIC_GOVERNING_LAW_JURISDICTION?.trim() || "the jurisdiction where the operator is established";
}
