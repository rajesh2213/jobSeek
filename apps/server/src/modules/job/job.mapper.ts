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
 * Serialize job for JSON API: plain-text description, company logo.
 */
export function toJobPublicJson(job: JobWithCompanyRow): Record<string, unknown> {
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
    company: {
      id: company.id,
      name: company.name,
      slug: company.slug,
      logoUrl: company.logoUrl ?? null,
      domain: company.domain ?? null,
      careerPage: company.careersUrl ?? null,
      openRoles: company._count?.jobs ?? 0,
    },
  };
}

/**
 * Free tier over daily cap: keep title/company/location for SEO and upgrade UX; hide body and apply targets.
 */
export function toJobPublicJsonOverDailyCap(job: JobWithCompanyRow): Record<string, unknown> {
  const full = toJobPublicJson(job);
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
