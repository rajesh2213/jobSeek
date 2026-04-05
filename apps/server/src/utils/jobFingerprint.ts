import { createHash } from "node:crypto";

export interface JobFingerprintInput {
  title: string;
  /** Normalized company domain (hostname) or stable fallback e.g. `company:<uuid>` */
  companyDomain: string;
  location?: string;
  description?: string;
}

export interface JobFingerprintV2Input {
  title: string;
  companyDomain: string;
  /** ISO 3166-1 alpha-2 or UNKNOWN */
  country: string;
  isRemote: boolean;
  description?: string;
  /** When present, dominates the bucket (same listing across sources). */
  atsJobId?: string | null;
  /** Optional; not included in v2 fingerprint identity (callers may still supply it). */
  applyUrl?: string | null;
}

const DESC_FINGERPRINT_MAX_LEN = 800;

/**
 * Normalize location for fingerprinting: remote vs city/country tokens, lowercase.
 * @deprecated Prefer ISO `country` + `isRemote` in v2.
 */
export function normalizeLocationForFingerprint(location: string | undefined): string {
  if (!location) return "";
  const t = location.trim().toLowerCase();
  if (/\bremote\b/i.test(t)) return "remote";
  return t.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Normalize title: lowercase, strip punctuation to alphanumerics + spaces.
 */
export function normalizeTitleForFingerprint(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalize apply URL for fingerprint (host + path, no query/hash). */
export function normalizeApplyUrlForFingerprint(url: string | undefined | null): string {
  if (!url?.trim()) return "";
  try {
    const u = new URL(url.trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/$/, "").toLowerCase();
    return `${host}${path}`;
  } catch {
    return url
      .trim()
      .toLowerCase()
      .slice(0, 240);
  }
}

function normalizeDescriptionSnippet(description: string | undefined): string {
  if (!description) return "";
  const normalized = description
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  return normalized;
}

/**
 * Stronger description signal for v2: 500–800 chars normalized, then hashed.
 */
export function normalizeDescriptionForFingerprintV2(description: string | undefined): string {
  if (!description) return "";
  return description
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DESC_FINGERPRINT_MAX_LEN);
}

/**
 * Legacy v1 SHA-256 (kept for migrations / backfill scripts).
 */
export function generateJobFingerprint(input: JobFingerprintInput): string {
  const domain = input.companyDomain.trim().toLowerCase();
  const title = normalizeTitleForFingerprint(input.title);
  const loc = normalizeLocationForFingerprint(input.location);
  const desc = normalizeDescriptionSnippet(input.description);
  const payload = [domain, title, loc, desc].join("|");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * V2 fingerprint: ATS id (if any) → description hash → title + ISO country + remote → company domain (apply URL excluded from identity).
 */
export function generateJobFingerprintV2(
  input: JobFingerprintV2Input,
): { fingerprint: string; version: "v2" } {
  const parts: string[] = ["v2"];

  if (input.atsJobId?.trim()) {
    parts.push(`ats:${input.atsJobId.trim().toLowerCase()}`);
  }

  const descNorm = normalizeDescriptionForFingerprintV2(input.description);
  const descDigest = descNorm
    ? createHash("sha256").update(descNorm, "utf8").digest("hex")
    : "";
  parts.push(`desc:${descDigest}`);

  parts.push(`t:${normalizeTitleForFingerprint(input.title)}`);
  const cc = (input.country || "UNKNOWN").trim().toUpperCase();
  parts.push(`cc:${cc}`);
  parts.push(`remote:${input.isRemote ? "1" : "0"}`);
  parts.push(`co:${input.companyDomain.trim().toLowerCase()}`);

  const payload = parts.join("|");
  const fingerprint = createHash("sha256").update(payload, "utf8").digest("hex");
  return { fingerprint, version: "v2" };
}

/**
 * Prefer careers page hostname for cross-ATS matching; stable fallback per company.
 */
export function extractCompanyDomain(
  careersUrl: string | null | undefined,
  companyId: string,
): string {
  if (careersUrl?.trim()) {
    try {
      const raw = careersUrl.trim();
      const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
      return url.hostname.toLowerCase();
    } catch {
      /* fall through */
    }
  }
  return `company:${companyId}`;
}
