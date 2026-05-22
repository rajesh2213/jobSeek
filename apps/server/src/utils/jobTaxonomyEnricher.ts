import type { DedupJobInput, NormalizedJob } from "../modules/crawler/crawler.types.js";
import { logger } from "./logger.js";
import { deriveExperienceLevel, deriveWorkType, extractSalaryMinUsd, normalizeJobAttributes } from "./taxonomyNormalizer.js";
import { deriveJobSkills } from "./jobSkills.js";

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
  const skills = deriveJobSkills({
    title: input.title,
    description: input.description,
    location: input.location,
    isRemote: input.isRemote,
    category: attrs.category,
    taxonomySkills: attrs.skills,
  });

  let salaryMin: number | null = null;
  let salaryMax: number | null = null;
  let salarySource: "jsonld" | "regex" | null = null;

  const ss = input.structuredSalary;
  if (ss && ss.currency.toUpperCase() === "USD") {
    salaryMin = ss.minValue;
    salaryMax = ss.maxValue ?? null;
    salarySource = "jsonld";
  }

  if (salaryMin == null) {
    salaryMin = extractSalaryMinUsd(input.description ?? "");
    salaryMax = null;
    salarySource = salaryMin != null ? "regex" : null;
  }

  if (salarySource) {
    logger.info(
      { event: "salary_extraction", source: salarySource, hasMax: salaryMax != null, atsType: input.source },
      "salary_extraction",
    );
  }

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
    skills,
    country: attrs.country,
    locationCity: attrs.city,
    locationState: attrs.state,
    locationCountry: attrs.country,
    locationRegion: attrs.region,
    salaryMin,
    salaryMax,
    salarySource,
    experienceLevel,
    ...(workType ? { workType } : {}),
    ...(attrs.hasMultipleLocations ? { hasMultipleLocations: true } : {}),
  };
}
