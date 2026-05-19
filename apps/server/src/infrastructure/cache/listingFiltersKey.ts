import { createHash } from "node:crypto";
import type { JobDiscoveryFilters } from "../../modules/job/job.repository.js";
import { summarizeJobDiscoveryFilters } from "../../modules/job/jobListMeteredDiag.js";

export function stableServerJobFiltersKey(
  filters: JobDiscoveryFilters | undefined,
): string {
  return createHash("sha256")
    .update(JSON.stringify(summarizeJobDiscoveryFilters(filters)))
    .digest("hex")
    .slice(0, 24);
}
