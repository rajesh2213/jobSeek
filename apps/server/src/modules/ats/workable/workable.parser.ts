import type { NormalizedJob } from "../../crawler/crawler.types.js";
import {
  inferRemote,
  normalizeLocation,
  parseDate,
  sanitizeHtml,
  trimWhitespace,
} from "../ats.interface.js";
import type { WorkableJob } from "./workable.types.js";

export function parseWorkableJobs(
  jobs: WorkableJob[],
  companyId: string,
): NormalizedJob[] {
  const normalized: NormalizedJob[] = [];
  for (const job of jobs ?? []) {
    const title = trimWhitespace(job.title);
    const sourceUrl = trimWhitespace(job.url);
    if (!title || !sourceUrl) continue;

    const location = normalizeLocation(
      job.location?.location_str ??
        [job.location?.city, job.location?.country].filter(Boolean).join(", "),
    );

    normalized.push({
      title,
      description: sanitizeHtml(job.full_description ?? job.description),
      location,
      isRemote: inferRemote(location),
      source: "workable",
      sourceUrl,
      postedAt: parseDate(job.published),
      companyId,
    });
  }
  return normalized;
}

