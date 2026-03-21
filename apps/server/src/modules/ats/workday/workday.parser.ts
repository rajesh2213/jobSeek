import type { NormalizedJob } from "../../crawler/crawler.types.js";
import {
  inferRemote,
  normalizeLocation,
  parseDate,
  sanitizeHtml,
  trimWhitespace,
} from "../ats.interface.js";
import type { WorkdayJob, WorkdayRawJob, WorkdayToken } from "./workday.types.js";

function formatLocation(job: WorkdayJob): string | undefined {
  const fromText = normalizeLocation(job.locationsText);
  if (fromText) return fromText;

  const locations = (job.locations ?? [])
    .map((loc) =>
      normalizeLocation([loc.city, loc.region, loc.country].filter(Boolean).join(", ")),
    )
    .filter((value): value is string => Boolean(value));

  return locations.length > 0 ? locations[0] : undefined;
}

function resolveSourceUrl(job: WorkdayJob, token: WorkdayToken): string | undefined {
  const externalPath = trimWhitespace(job.externalPath);
  if (!externalPath) return undefined;
  if (externalPath.startsWith("http://") || externalPath.startsWith("https://")) {
    return externalPath;
  }
  return `https://${token.host}${externalPath.startsWith("/") ? "" : "/"}${externalPath}`;
}

export function parseWorkdayJobs(
  jobs: WorkdayRawJob[],
  companyId: string,
): NormalizedJob[] {
  const normalized: NormalizedJob[] = [];
  for (const item of jobs ?? []) {
    const token: WorkdayToken = item.token;
    const job: WorkdayJob = item.job;
    const title = trimWhitespace(job.title);
    const sourceUrl = resolveSourceUrl(job, token);
    if (!title || !sourceUrl) continue;

    const location = formatLocation(job);
    normalized.push({
      title,
      description: sanitizeHtml(job.jobDescription),
      location,
      isRemote: inferRemote(location),
      source: "workday",
      sourceUrl,
      postedAt: parseDate(job.postedOn),
      companyId,
    });
  }
  return normalized;
}

