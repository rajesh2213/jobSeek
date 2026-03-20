import type { NormalizedJob } from "../../crawler/crawler.types.js";
import {
  inferRemote,
  normalizeLocation,
  sanitizeHtml,
  trimWhitespace,
} from "../ats.interface.js";
import type { LeverJob } from "./lever.types.js";

function parseLeverPostedAt(epochMs: number | undefined): Date | undefined {
  if (typeof epochMs !== "number") return undefined;
  const d = new Date(epochMs);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function parseLeverJobs(
  jobs: LeverJob[],
  companyId: string,
): NormalizedJob[] {
  const safeJobs = jobs ?? [];
  const normalized: NormalizedJob[] = [];

  for (const job of safeJobs) {
    const title = trimWhitespace(job.text);
    const sourceUrl = trimWhitespace(job.hostedUrl ?? job.applyUrl);
    if (!title || !sourceUrl) continue;

    const location = normalizeLocation(job.categories?.location);
    normalized.push({
      title,
      description: sanitizeHtml(job.descriptionPlain ?? job.description),
      location,
      isRemote: inferRemote(location),
      source: "lever",
      sourceUrl,
      postedAt: parseLeverPostedAt(job.createdAt),
      companyId,
    });
  }

  return normalized;
}

