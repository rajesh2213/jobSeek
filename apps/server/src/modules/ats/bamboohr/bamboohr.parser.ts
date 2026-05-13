import type { NormalizedJob } from "../../crawler/crawler.types.js";
import {
  inferRemote,
  normalizeLocation,
  parseDate,
  sanitizeHtml,
  trimWhitespace,
} from "../ats.interface.js";
import type { BambooHrRawJob } from "./bamboohr.types.js";

export function parseBambooHrJobs(
  jobs: BambooHrRawJob[],
  companyId: string,
): NormalizedJob[] {
  const normalized: NormalizedJob[] = [];
  for (const job of jobs ?? []) {
    const title = trimWhitespace(job.title);
    const sourceUrl = trimWhitespace(job.sourceUrl);
    if (!title || !sourceUrl) continue;

    const location = normalizeLocation(job.location);
    normalized.push({
      title,
      description: sanitizeHtml(job.description),
      location,
      isRemote: inferRemote(location),
      source: "bamboohr",
      sourceUrl,
      applyUrl: sourceUrl,
      postedAt: parseDate(job.postedAt),
      companyId,
      ...(job.salary ? { structuredSalary: job.salary } : {}),
    });
  }
  return normalized;
}

