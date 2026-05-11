function titleCaseWords(raw: string): string {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function sanitizeToken(raw: string): string {
  return raw
    .replace(/%[0-9a-fA-F]{2}/g, " ")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractHostFromPlaceholder(name: string): string | null {
  const colonIdx = name.indexOf(":");
  if (colonIdx < 0) return null;
  const afterPrefix = name.slice(colonIdx + 1);
  const host = afterPrefix.split("__")[0]?.trim() ?? "";
  return host || null;
}

function extractTenantFromWorkdayPlaceholder(name: string): string | null {
  const m = name.match(/^workday:([^_]+)__([^_]+)__/i);
  if (!m) return null;
  const tenant = sanitizeToken(m[2] ?? "");
  return tenant || null;
}

function companyFromHost(host: string): string | null {
  const label = host.split(".")[0]?.trim() ?? "";
  if (!label) return null;
  const cleaned = sanitizeToken(label);
  if (!cleaned) return null;
  return titleCaseWords(cleaned);
}

export function isAtsPlaceholderCompanyName(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.trim().toLowerCase();
  if (!n.includes(":")) return false;
  if (n.startsWith("workday:") && n.includes("__")) return true;
  return /^[a-z]+:[a-z0-9.-]+(__[a-z0-9._-]+)+$/.test(n);
}

/**
 * Presentation-only fallback for ugly ATS placeholder names.
 * Keeps persisted DB value unchanged while making public output cleaner.
 */
export function companyDisplayName(name: string, domain?: string | null): string {
  const trimmed = name.trim();
  if (!isAtsPlaceholderCompanyName(trimmed)) return trimmed;

  const wdTenant = extractTenantFromWorkdayPlaceholder(trimmed);
  if (wdTenant) return titleCaseWords(wdTenant);

  const host = extractHostFromPlaceholder(trimmed);
  if (host) {
    const fromHost = companyFromHost(host);
    if (fromHost) return fromHost;
  }

  if (domain) {
    const fromDomain = companyFromHost(domain);
    if (fromDomain) return fromDomain;
  }

  return trimmed;
}
