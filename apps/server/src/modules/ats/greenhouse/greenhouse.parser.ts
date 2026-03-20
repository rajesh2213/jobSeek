import type { NormalizedJob } from "../../crawler/crawler.types.js";
import {
  inferRemote,
  normalizeLocation,
  parseDate,
  sanitizeHtml,
  trimWhitespace,
} from "../ats.interface.js";
import type { GreenhouseJobSummary } from "./greenhouse.types.js";

export function parseGreenhouseJobList(
  jobs: GreenhouseJobSummary[],
  companyId: string,
): NormalizedJob[] {
  const safeJobs = jobs ?? [];

  const normalized: NormalizedJob[] = [];
  for (const job of safeJobs) {
    const title = trimWhitespace(job.title);
    const sourceUrl = trimWhitespace(job.absolute_url);
    if (!title || !sourceUrl) continue;

    const locationName = normalizeLocation(job.location?.name);

    normalized.push({
      title,
      description: sanitizeHtml(job.content),
      location: locationName,
      isRemote: inferRemote(locationName),
      source: "greenhouse",
      sourceUrl,
      postedAt: parseDate(job.updated_at),
      companyId,
    });
  }

  return normalized;
}

