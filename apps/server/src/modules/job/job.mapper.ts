import type { Job } from "@prisma/client";
import { cleanJobDescription } from "../../utils/cleanJobDescription.js";
import { LIST_JOB_DESCRIPTION_MAX_CHARS } from "./jobListing.constants.js";
import { buildJobPreviewLines } from "./jobPreviewLines.js";
import { companyDisplayName } from "../../utils/companyDisplayName.js";

export type JobCompanyPublic = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  domain: string | null;
  careersUrl: string | null;
  _count?: { jobs: number };
};

/** Row shape from Prisma include (listing + detail). */
export type JobWithCompanyRow = Job & { company: JobCompanyPublic };

/**
 * Shared company serializer for list/detail payloads.
 */
/** List payloads only: keep non-null descriptions but cap length (ellipsis). */
function truncateJobDescriptionForList(
  cleaned: string | null | undefined,
  maxChars: number = LIST_JOB_DESCRIPTION_MAX_CHARS,
): string | null {
  if (cleaned == null) return null;
  const t = cleaned.trim();
  if (t.length === 0) return "";
  if (t.length <= maxChars) return t;
  const slice = t.slice(0, Math.max(1, maxChars - 1)).trimEnd();
  return `${slice}…`;
}

function toCompanyPublic(company: JobCompanyPublic): Record<string, unknown> {
  return {
    id: company.id,
    name: companyDisplayName(company.name, company.domain),
    slug: company.slug,
    logoUrl: company.logoUrl ?? null,
    domain: company.domain ?? null,
    careerPage: company.careersUrl ?? null,
    openRoles: company._count?.jobs ?? 0,
  };
}

/**
 * List serializer (phase 1): keep `description` for compatibility, omit heavy parsed/enriched fields.
 */
export function toJobListJson(job: JobWithCompanyRow): Record<string, unknown> {
  const { company, parsedDescription: _parsedDescription, enriched: _enriched, ...rest } = job;
  const cleanedFull = cleanJobDescription(job.description);
  const preview = buildJobPreviewLines({
    parsedDescription: job.parsedDescription,
    description: job.description,
    company: job.company,
  });
  const description = truncateJobDescriptionForList(cleanedFull);
  return {
    ...rest,
    description,
    previewLines: preview.previewLines,
    previewLinesSource: preview.previewLinesSource,
    company: toCompanyPublic(company),
    /** Listing sort key; aligns with DB `listingFreshnessAt` (= COALESCE(effectivePostedAt, createdAt)). */
    effectivePostedAt: job.effectivePostedAt ?? null,
  };
}

/**
 * Detail serializer: full payload required for job detail UX.
 */
export function toJobDetailJson(job: JobWithCompanyRow): Record<string, unknown> {
  const { description, company, ...rest } = job;
  const preview = buildJobPreviewLines({
    parsedDescription: job.parsedDescription,
    description,
    company,
  });
  return {
    ...rest,
    description: cleanJobDescription(description),
    previewLines: preview.previewLines,
    previewLinesSource: preview.previewLinesSource,
    company: toCompanyPublic(company),
  };
}

/**
 * Free tier over daily cap: keep title/company/location for SEO and upgrade UX; hide body and apply targets.
 */
export function toJobPublicJsonOverDailyCap(job: JobWithCompanyRow): Record<string, unknown> {
  const full = toJobDetailJson(job);
  return {
    ...full,
    /** SSR-only structured data fallback while keeping capped UI payload redacted. */
    structuredDataDescription: full.description,
    description: null,
    parsedDescription: null,
    previewLines: [],
    previewLinesSource: "none",
    applyUrl: null,
    sourceUrl: null,
  };
}

/**
 * Legacy alias retained for backward compatibility while migrating call sites.
 */
export const toJobPublicJson = toJobDetailJson;
