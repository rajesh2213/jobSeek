import type { DedupJobInput, NormalizedJob } from "../modules/crawler/crawler.types.js";
import { deriveExperienceLevel, deriveWorkType, extractSalaryMinUsd, normalizeJobAttributes } from "./taxonomyNormalizer.js";

/**
 * Derive taxonomy + ISO country from raw ATS payload.
 */
export function enrichDedupInput(
  input: NormalizedJob & { companyDomain: string },
): DedupJobInput {
  const attrs = normalizeJobAttributes({
    title: input.title,
    description: input.description,
    location: input.location,
    isRemote: input.isRemote,
  });
  const salaryMin = extractSalaryMinUsd(input.description ?? "");
  const experienceLevel = deriveExperienceLevel(input.title);
  const workType = deriveWorkType(input.title, input.description, input.location);

  return {
    title: input.title,
    description: input.description,
    isRemote: input.isRemote,
    source: input.source,
    sourceUrl: input.sourceUrl,
    applyUrl: input.applyUrl,
    postedAt: input.postedAt,
    companyId: input.companyId,
    atsJobId: input.atsJobId,
    companyDomain: input.companyDomain,
    category: attrs.category,
    role: attrs.role,
    skills: attrs.skills,
    country: attrs.country,
    locationCity: attrs.city,
    locationState: attrs.state,
    locationCountry: attrs.country,
    locationRegion: attrs.region,
    salaryMin,
    experienceLevel,
    ...(workType ? { workType } : {}),
    ...(attrs.hasMultipleLocations ? { hasMultipleLocations: true } : {}),
  };
}
