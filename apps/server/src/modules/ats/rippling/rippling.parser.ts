import type { NormalizedJob } from "../../crawler/crawler.types.js";
import {
  inferRemote,
  normalizeLocation,
  parseDate,
  sanitizeHtml,
  trimWhitespace,
} from "../ats.interface.js";
import type { RipplingRawJob } from "./rippling.types.js";

export function parseRipplingJobs(
  jobs: RipplingRawJob[],
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
      source: "rippling",
      sourceUrl,
      postedAt: parseDate(job.postedAt),
      companyId,
    });
  }
  return normalized;
}

