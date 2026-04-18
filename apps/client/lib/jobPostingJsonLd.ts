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
    datePosted:
      job.postedAt && !Number.isNaN(Date.parse(job.postedAt)) ? job.postedAt : undefined,
    description: description || undefined,
  };

  if (job.isRemote || job.workType === "remote") {
    base.jobLocationType = "TELECOMMUTE";
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
