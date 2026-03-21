import type { NormalizedJob } from "../../crawler/crawler.types.js";
import {
  inferRemote,
  normalizeLocation,
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
    const sourceUrl =
      trimWhitespace(job.applyUrl) ??
      (job.id && companyToken
        ? `https://jobs.smartrecruiters.com/${companyToken}/${job.id}`
        : undefined);
    if (!title || !sourceUrl) continue;

    const location = normalizeLocation(
      [job.location?.city, job.location?.region, job.location?.country]
        .filter(Boolean)
        .join(", "),
    );

    normalized.push({
      title,
      description: undefined,
      location,
      isRemote: inferRemote(location),
      source: "smartrecruiters",
      sourceUrl,
      postedAt: parseDate(job.releasedDate),
      companyId,
    });
  }
  return normalized;
}

