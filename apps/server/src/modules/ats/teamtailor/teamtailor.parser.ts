import type { NormalizedJob } from "../../crawler/crawler.types.js";
import {
  inferRemote,
  normalizeLocation,
  parseDate,
  sanitizeHtml,
  trimWhitespace,
} from "../ats.interface.js";
import type { TeamtailorJob } from "./teamtailor.types.js";

export function parseTeamtailorJobs(
  jobs: TeamtailorJob[],
  companyId: string,
  token?: string,
): NormalizedJob[] {
  const normalized: NormalizedJob[] = [];
  for (const job of jobs ?? []) {
    const attrs = job.attributes;
    const title = trimWhitespace(attrs?.title);
    const sourceUrl =
      trimWhitespace(attrs?.external_application_url) ??
      (token && job.id
        ? `https://${token}.teamtailor.com/jobs/${job.id}`
        : undefined);
    if (!title || !sourceUrl) continue;

    const location = normalizeLocation(attrs?.location);
    normalized.push({
      title,
      description: sanitizeHtml(attrs?.body),
      location,
      isRemote: inferRemote(location),
      source: "teamtailor",
      sourceUrl,
      applyUrl: sourceUrl,
      postedAt: parseDate(
        attrs?.published_at ?? attrs?.start_date ?? attrs?.created_at,
      ),
      companyId,
    });
  }
  return normalized;
}

