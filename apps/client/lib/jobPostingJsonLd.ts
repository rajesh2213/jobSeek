import type { JobItem } from "./api";
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

export function buildJobPostingJsonLd(
  job: JobItem,
  description: string | undefined,
): Record<string, unknown> {
  const url = absoluteUrl(`/job/${job.id}`);
  const country = (job.locationCountry || job.country || "").trim();
  const cc = country.length === 2 ? country.toUpperCase() : "";
  const currency = cc ? COUNTRY_CURRENCY[cc] ?? "USD" : "USD";
  /**
   * Strategy A (freshness-overhaul Phase 6): only emit `datePosted` when we have a
   * real employer-supplied publish date. We MUST NOT pass crawl/discovery
   * timestamps to Google as if they were `datePosted` — that contaminates Rich
   * Results with fake freshness and harms long-term SEO trust.
   *
   * Schema.org allows `datePosted` to be omitted; Google treats missing `datePosted`
   * as "use crawl-time-of-page" which is the correct fallback for discovery-only rows.
   */
  const datePosted = firstValidPostedIso(job.postedAt);
  const validThrough = computeValidThrough(job.postedAt);
  const resolvedDescription = resolveDescription(job, description);

  const org: Record<string, unknown> = {
    "@type": "Organization",
    name: job.company.name,
  };
  if (job.company.domain?.trim()) {
    org.sameAs = `https://${job.company.domain.replace(/^https?:\/\//, "")}`;
  }

  const base: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    url,
    hiringOrganization: org,
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressCountry: cc || country || undefined,
      },
    },
    /** Only when freshnessSource === POSTED. Omit otherwise. */
    ...(datePosted ? { datePosted } : {}),
    /** validThrough mirrors datePosted: only emit when we actually have a publish date to extend from. */
    ...(validThrough ? { validThrough } : {}),
    employmentType: employmentType(job.workType),
    description: resolvedDescription || undefined,
  };

  if (job.isRemote || job.workType === "remote") {
    base.jobLocationType = "TELECOMMUTE";
    if (cc || country) {
      base.applicantLocationRequirements = {
        "@type": "Country",
        name: cc || country,
      };
    }
  }

  if (job.salaryMin != null && job.salaryMin > 0) {
    base.baseSalary = {
      "@type": "MonetaryAmount",
      currency,
      value: {
        "@type": "QuantitativeValue",
        value: job.salaryMin,
        unitText: "YEAR",
      },
    };
  }

  return base;
}

function employmentType(workType: string | undefined): string | undefined {
  const t = (workType ?? "").toLowerCase();
  if (t === "remote") return "FULL_TIME";
  if (t === "hybrid") return "FULL_TIME";
  if (t === "onsite") return "FULL_TIME";
  return undefined;
}

/**
 * Strategy A: validThrough is only meaningful when `datePosted` is emitted.
 * Returns `postedAt + 45 days` when postedAt is a valid ISO string, else `undefined`.
 */
function computeValidThrough(postedAt: string | null): string | undefined {
  if (!postedAt) return undefined;
  const d = new Date(postedAt);
  if (Number.isNaN(d.getTime())) return undefined;
  d.setUTCDate(d.getUTCDate() + 45);
  return d.toISOString();
}

function firstValidPostedIso(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (Number.isNaN(Date.parse(value))) return undefined;
  return value;
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
    /** Capped-detail API: UI `description` is null; this field preserves SSR JSON-LD only. */
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
