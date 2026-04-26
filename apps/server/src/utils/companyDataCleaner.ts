export type CleanCompanyInputResult =
  | {
      valid: true;
      name: string;
      domain: string;
    }
  | {
      valid: false;
      reason:
        | "invalid_name"
        | "missing_website"
        | "invalid_website"
        | "linkedin_filtered"
        | "invalid_url"
        | "no_domain";
    };

function normalizeWebsite(raw: string): string {
  const trimmed = raw.trim().toLowerCase();

  if (!trimmed.startsWith("http")) {
    return `https://${trimmed}`;
  }

  return trimmed;
}

function extractDomain(urlStr: string): string | null {
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname.replace(/^www\./, "").trim();
    return hostname || null;
  } catch {
    return null;
  }
}

export function cleanCompanyInput(input: {
  name: string;
  website?: string | null;
}): CleanCompanyInputResult {
  // Name validation
  if (!input.name || input.name.trim().length < 2) {
    return { valid: false, reason: "invalid_name" };
  }

  // Website validation
  if (!input.website) {
    return { valid: false, reason: "missing_website" };
  }

  const raw = input.website.trim().toLowerCase();

  // Reject junk values
  if (["na", "n/a", "-", ""].includes(raw)) {
    return { valid: false, reason: "invalid_website" };
  }

  // Reject LinkedIn URLs
  if (raw.includes("linkedin.com")) {
    return { valid: false, reason: "linkedin_filtered" };
  }

  const normalizedUrl = normalizeWebsite(raw);
  const domain = extractDomain(normalizedUrl);

  if (!domain) {
    return { valid: false, reason: "no_domain" };
  }

  return {
    valid: true,
    name: input.name.trim(),
    domain,
  };
}
