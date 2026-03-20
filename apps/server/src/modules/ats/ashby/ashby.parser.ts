import type { NormalizedJob } from "../../crawler/crawler.types.js";
import {
  inferRemote,
  normalizeLocation,
  parseDate,
  sanitizeHtml,
  trimWhitespace,
} from "../ats.interface.js";
import type { AshbyJob } from "./ashby.types.js";

function getAshbyLocation(job: AshbyJob): string | undefined {
  if (typeof job.location === "string") return normalizeLocation(job.location);
  if (job.location && typeof job.location === "object") {
    return normalizeLocation(job.location.location ?? job.location.name);
  }
  return undefined;
}

export function parseAshbyJobs(
  jobs: AshbyJob[],
  companyId: string,
): NormalizedJob[] {
  const safeJobs = jobs ?? [];
  const normalized: NormalizedJob[] = [];

  for (const job of safeJobs) {
    const title = trimWhitespace(job.title);
    const sourceUrl = trimWhitespace(job.jobUrl ?? job.externalLink);
    if (!title || !sourceUrl) continue;

    const location = getAshbyLocation(job);
    normalized.push({
      title,
      description: sanitizeHtml(job.descriptionPlain ?? job.descriptionHtml),
      location,
      isRemote: Boolean(job.isRemote) || inferRemote(location),
      source: "ashby",
      sourceUrl,
      postedAt: parseDate(job.postedDate ?? job.createdAt),
      companyId,
    });
  }

  return normalized;
}

