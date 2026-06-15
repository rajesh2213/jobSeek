import type { JobItem } from "./api";
import { shouldIndexJob } from "./jobLifecycle";
import { absoluteUrl } from "./seoSite";

/** ISO 3166-1 alpha-2 → ISO 4217; fallback USD when unknown. */
const COUNTRY_CURRENCY: Record<string, string> = {
  US: "USD",
  GB: "GBP",
  IN: "INR",
  DE: "EUR",
  FR: "EUR",
  NL: "EUR",
  ES: "EUR",
  CA: "CAD",
  AU: "AUD",
  SG: "SGD",
};

/**
 * Google Job Posting requires `datePosted` for valid rich results.
 * Prefer POSTED freshness / postedAt; fall back to effectivePostedAt (listing discovery date).
 */
export function resolveJobPostingDatePosted(job: JobItem): string | undefined {
  if (job.freshness?.source === "POSTED" && job.freshness.timestamp) {
    return firstValidPostedIso(job.freshness.timestamp);
  }
  return (
    firstValidPostedIso(job.postedAt) ??
    firstValidPostedIso(job.effectivePostedAt ?? undefined)
  );
}

/** True when JobPosting JSON-LD should be emitted (indexable + description + valid datePosted). */
export function shouldEmitJobPostingJsonLd(
  job: JobItem,
  description: string | undefined,
): boolean {
  // Expired/inactive jobs remain accessible but should not be indexed by search engines.
  if (!shouldIndexJob(job)) return false;
  const resolved = resolveDescriptionOrFallback(job, description);
  if (!resolved) return false;
  return resolveJobPostingDatePosted(job) != null;
}

export function buildJobPostingJsonLd(
  job: JobItem,
  description: string | undefined,
): Record<string, unknown> {
  const url = absoluteUrl(`/job/${job.id}`);
  const country = (job.locationCountry || job.country || "").trim();
  const cc = country.length === 2 ? country.toUpperCase() : "";
  const currency = cc ? (COUNTRY_CURRENCY[cc] ?? "USD") : "USD";
  const datePosted = resolveJobPostingDatePosted(job);
  const validThrough = computeValidThrough(datePosted);
  const resolvedDescription = resolveDescriptionOrFallback(job, description);

  const org: Record<string, unknown> = {
    "@type": "Organization",
    name: job.company.name,
  };
  if (job.company.domain?.trim()) {
    org.sameAs = `https://${job.company.domain.replace(/^https?:\/\//, "")}`;
  }

  const address = buildJobPostingAddress(job, cc, country);

  const base: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    url,
    hiringOrganization: org,
    jobLocation: {
      "@type": "Place",
      address,
    },
    datePosted,
    ...(validThrough ? { validThrough } : {}),
    employmentType: employmentType(job.workType),
    description: resolvedDescription || undefined,
  };

  if (job.isRemote || job.workType === "remote") {
    base.jobLocationType = "TELECOMMUTE";
    const locName = cc || country || "US";
    base.applicantLocationRequirements = {
      "@type": "Country",
      name: locName,
    };
  }

  const salary = buildBaseSalary(job, currency);
  if (salary) base.baseSalary = salary;

  return base;
}

function buildJobPostingAddress(
  job: JobItem,
  countryCode: string,
  countryRaw: string,
): Record<string, unknown> {
  const address: Record<string, unknown> = {
    "@type": "PostalAddress",
    addressCountry: countryCode || countryRaw || undefined,
  };
  const city = job.locationCity?.trim();
  const region = job.locationState?.trim() || job.locationRegion?.trim();
  if (city) address.addressLocality = city;
  if (region) address.addressRegion = region;
  return address;
}

function buildBaseSalary(
  job: JobItem,
  currency: string,
): Record<string, unknown> | null {
  const min = job.salaryMin;
  const max = job.salaryMax;
  const hasMin = typeof min === "number" && min > 0;
  const hasMax = typeof max === "number" && max > 0;
  if (!hasMin && !hasMax) return null;

  if (hasMin && hasMax && max! >= min!) {
    return {
      "@type": "MonetaryAmount",
      currency,
      value: {
        "@type": "QuantitativeValue",
        minValue: min,
        maxValue: max,
        unitText: "YEAR",
      },
    };
  }

  const value = hasMin ? min : max;
  return {
    "@type": "MonetaryAmount",
    currency,
    value: {
      "@type": "QuantitativeValue",
      value,
      unitText: "YEAR",
    },
  };
}

function employmentType(workType: string | undefined): string | undefined {
  const t = (workType ?? "").toLowerCase();
  if (t === "remote") return "FULL_TIME";
  if (t === "hybrid") return "FULL_TIME";
  if (t === "onsite") return "FULL_TIME";
  return undefined;
}

function computeValidThrough(datePosted: string | undefined): string | undefined {
  if (!datePosted) return undefined;
  const d = new Date(datePosted);
  if (Number.isNaN(d.getTime())) return undefined;
  d.setUTCDate(d.getUTCDate() + 45);
  return d.toISOString();
}

function firstValidPostedIso(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (Number.isNaN(Date.parse(value))) return undefined;
  return value;
}

function resolveDescriptionOrFallback(
  job: JobItem,
  preferred: string | undefined,
): string | undefined {
  return (
    resolveDescription(job, preferred) ??
    `${job.title.trim()} at ${job.company.name.trim()}. View role details and apply via the employer career page.`
  );
}

function resolveDescription(job: JobItem, preferred: string | undefined): string | undefined {
  const extras = job as JobItem & {
    descriptionText?: string | null;
    rawDescription?: string | null;
    descriptionHtml?: string | null;
  };
  const candidates = [
    preferred,
    job.description ?? undefined,
    job.structuredDataDescription ?? undefined,
    extras.descriptionText ?? undefined,
    extras.rawDescription ?? undefined,
    extras.descriptionHtml ?? undefined,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeDescription(candidate);
    if (normalized) return normalized;
  }
  return undefined;
}

function normalizeDescription(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const stripped = stripHtmlToText(input);
  const collapsed = stripped.replace(/\s+/g, " ").trim();
  if (!collapsed) return undefined;
  return collapsed.slice(0, 12000);
}

function stripHtmlToText(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}
