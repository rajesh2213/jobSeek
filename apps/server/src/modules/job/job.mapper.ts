import type { Job } from "@prisma/client";
import { cleanJobDescription } from "../../utils/cleanJobDescription.js";
import { buildJobPreviewLines } from "./jobPreviewLines.js";

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
function toCompanyPublic(company: JobCompanyPublic): Record<string, unknown> {
  return {
    id: company.id,
    name: company.name,
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
  const description = cleanJobDescription(job.description);
  const preview = buildJobPreviewLines({
    parsedDescription: job.parsedDescription,
    description: job.description,
    company: job.company,
  });
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
