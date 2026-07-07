import {
  hasNonemptyDescription,
  hasValidWorkdayUrlShape,
} from "../../../services/qualityFlags.service.js";

/**
 * Workday primary job needing repair: empty description and/or invalid listing URL shape.
 * Includes rows with description but root-path URL (still not publishable).
 */
export function isWorkdayPoisonedJob(job: {
  source: string;
  description: string | null | undefined;
  sourceUrl: string;
}): boolean {
  if (job.source !== "workday") return false;
  const needsDescription = !hasNonemptyDescription(job.description);
  const needsUrl = !hasValidWorkdayUrlShape(job.source, job.sourceUrl);
  return needsDescription || needsUrl;
}

export function isWorkdayRootPathUrl(sourceUrl: string): boolean {
  return !hasValidWorkdayUrlShape("workday", sourceUrl);
}

/** True when inline detail enrichment failed and row should not receive a poison hash-cache write. */
export function workdayNeedsDetailRecovery(input: {
  source: string;
  description?: string | null;
  sourceUrl: string;
  detailNeedsRecovery?: boolean;
}): boolean {
  if (input.source !== "workday") return false;
  if (input.detailNeedsRecovery) return true;
  return isWorkdayPoisonedJob({
    source: input.source,
    description: input.description ?? null,
    sourceUrl: input.sourceUrl,
  });
}
