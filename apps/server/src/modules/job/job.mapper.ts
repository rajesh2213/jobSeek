import type { Job } from "@prisma/client";
import { cleanJobDescription } from "../../utils/cleanJobDescription.js";
import { LIST_JOB_DESCRIPTION_MAX_CHARS } from "./jobListing.constants.js";
import { buildJobPreviewLines } from "./jobPreviewLines.js";
import { companyDisplayName } from "../../utils/companyDisplayName.js";
import { deriveFreshness, type Freshness } from "../../utils/freshness.js";

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

/**
 * Backend-owned freshness contract. Frontends must consume this rather than
 * inferring "Posted" vs "Added" from `postedAt != null` themselves.
 *
 * `now` is parameterized to keep serializers deterministic under test; production
 * callers pass nothing and we sample `Date.now()` once per serialization.
 */
function buildFreshness(job: Pick<Job, "postedAt" | "createdAt">, now: Date = new Date()): Freshness {
  return deriveFreshness({ postedAt: job.postedAt, createdAt: job.createdAt }, now);
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

/** Listing cards: omit domain/careersUrl/openRoles — not used on JobCard. */
function toCompanyListPublic(company: JobCompanyPublic): Record<string, unknown> {
  return {
    id: company.id,
    name: companyDisplayName(company.name, company.domain),
    slug: company.slug,
    logoUrl: company.logoUrl ?? null,
  };
}

/**
 * List serializer: explicit field allowlist; omit parsed/enriched; drop `description` when previews exist.
 */
export function toJobListJson(job: JobWithCompanyRow): Record<string, unknown> {
  const { company } = job;
  const preview = buildJobPreviewLines({
    parsedDescription: job.parsedDescription,
    description: job.description,
    company: job.company,
  });
  const hasPreview = preview.previewLines.length > 0;
  const cleanedFull = cleanJobDescription(job.description);
  const description = hasPreview
    ? null
    : truncateJobDescriptionForList(cleanedFull);
  return {
    id: job.id,
    title: job.title,
    status: job.status,
    country: job.country,
    locationCountry: job.locationCountry,
    isRemote: job.isRemote,
    workType: job.workType,
    skills: job.skills,
    salaryMin: job.salaryMin,
    sourceUrl: job.sourceUrl,
    applyUrl: job.applyUrl,
    postedAt: job.postedAt,
    effectivePostedAt: job.effectivePostedAt ?? null,
    createdAt: job.createdAt,
    description,
    previewLines: preview.previewLines,
    previewLinesSource: preview.previewLinesSource,
    company: toCompanyListPublic(company),
    freshness: buildFreshness(job),
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
    freshness: buildFreshness(job),
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
