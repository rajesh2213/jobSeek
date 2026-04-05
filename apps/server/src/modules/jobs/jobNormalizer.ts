import type { AtsType } from "../ats/ats.interface.js";

export type NormalizedJob = {
  title: string;
  description: string | null;
  sourceUrl: string;
  applyUrl: string | null;
  postedAt: Date | null;
  locationRaw?: string | null;
};

function parseDateMaybe(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Convert loosely-shaped raw ATS job into a standardized shape.
 * - Requires: title + sourceUrl
 * - Gracefully handles: description/applyUrl/postedAt/location missing
 */
export function normalizeRawJob(
  rawJob: unknown,
  _atsType: AtsType,
): NormalizedJob | null {
  if (!rawJob || typeof rawJob !== "object") return null;
  const r = rawJob as Record<string, unknown>;

  const title = typeof r.title === "string" ? r.title.trim() : "";
  const sourceUrl = typeof r.sourceUrl === "string" ? r.sourceUrl.trim() : "";
  if (!title || !sourceUrl) return null;

  const description =
    typeof r.description === "string" ? r.description.trim() : null;

  const applyUrlCandidate =
    typeof r.applyUrl === "string" ? r.applyUrl.trim() : null;
  const applyUrl = applyUrlCandidate || sourceUrl;

  const postedAt = parseDateMaybe(r.postedAt);

  const locationRaw =
    (typeof r.locationRaw === "string" ? r.locationRaw.trim() : null) ||
    (typeof r.location === "string" ? r.location.trim() : null);

  return {
    title,
    description: description && description.length > 0 ? description : null,
    sourceUrl,
    applyUrl,
    postedAt,
    locationRaw: locationRaw && locationRaw.length > 0 ? locationRaw : null,
  };
}

