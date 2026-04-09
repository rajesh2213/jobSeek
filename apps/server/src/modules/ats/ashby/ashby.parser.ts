/**
 * Location fields (Ashby public job board API):
 * - `location`: primary office line (string or object with name/location).
 * - `secondaryLocations`: extra sites; merged into one semicolon-separated line for resolveLocation.
 * Remote/hybrid flags come from `isRemote` / `workplaceType` on the job object when present.
 */
import type { NormalizedJob } from "../../crawler/crawler.types.js";
import {
  inferRemote,
  normalizeLocation,
  parseDate,
  sanitizeHtml,
  trimWhitespace,
} from "../ats.interface.js";
import type { AshbyJob } from "./ashby.types.js";

const MAX_ASHBY_LOCATION_LINE_CHARS = 500;

function primaryAshbyLocationLine(job: AshbyJob): string | undefined {
  if (typeof job.location === "string") return normalizeLocation(job.location);
  if (job.location && typeof job.location === "object") {
    return normalizeLocation(job.location.location ?? job.location.name);
  }
  return undefined;
}

function getAshbyLocation(job: AshbyJob): string | undefined {
  const primary = primaryAshbyLocationLine(job);
  const secondaries = job.secondaryLocations ?? [];
  const extra: string[] = [];
  const seen = new Set<string>();
  if (primary) seen.add(primary.toLowerCase());
  for (const s of secondaries) {
    const line = normalizeLocation(
      typeof s?.location === "string" ? s.location : undefined,
    );
    if (!line) continue;
    const k = line.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    extra.push(line);
  }
  if (!primary && extra.length === 0) return undefined;
  const merged = [primary, ...extra].filter(Boolean).join("; ");
  if (merged.length <= MAX_ASHBY_LOCATION_LINE_CHARS) return merged;
  return merged.slice(0, MAX_ASHBY_LOCATION_LINE_CHARS - 1).trimEnd() + "…";
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

