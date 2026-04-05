import type { NormalizedJob } from "../../crawler/crawler.types.js";
import {
  inferRemote,
  normalizeLocation,
  sanitizeHtml,
  parseDate,
  trimWhitespace,
} from "../ats.interface.js";
import type { SmartRecruitersJob } from "./smartrecruiters.types.js";

export function parseSmartRecruitersJobs(
  jobs: SmartRecruitersJob[],
  companyId: string,
  companyToken?: string,
): NormalizedJob[] {
  const normalized: NormalizedJob[] = [];
  for (const job of jobs ?? []) {
    const title = trimWhitespace(job.name);
    const companyTokenResolved = job.companyToken ?? companyToken;
    const sourceUrl =
      trimWhitespace(job.applyUrl) ??
      (job.id && companyTokenResolved
        ? `https://jobs.smartrecruiters.com/${companyTokenResolved}/${job.id}`
        : undefined);
    if (!title || !sourceUrl) continue;

    const location = normalizeLocation(
      [job.location?.city, job.location?.region, job.location?.country]
        .filter(Boolean)
        .join(", "),
    );

    normalized.push({
      title,
      description: sanitizeHtml(job.description),
      location,
      isRemote: inferRemote(location),
      source: "smartrecruiters",
      sourceUrl,
      applyUrl: sourceUrl,
      postedAt: parseDate(job.postedAt ?? job.releasedDate),
      companyId,
    });
  }
  return normalized;
}

