/**
 * Mirrors client `filtersToSlug` in `apps/client/lib/slug-parser.ts` — keep in sync.
 */
export function filtersToJobListingSlug(filters: {
  category?: string;
  role?: string;
  skills?: string[];
  country?: string;
  isRemote?: boolean;
  workType?: "remote" | "onsite" | "hybrid";
}): string {
  const parts: string[] = [];
  if (filters.category) parts.push(filters.category);
  if (filters.role) parts.push(...filters.role.split("-").filter(Boolean));
  if (filters.skills?.length) parts.push(...[...filters.skills].sort());
  if (filters.country) parts.push(filters.country.toLowerCase());
  if (filters.workType === "remote" || filters.isRemote) parts.push("remote");
  return parts.join("-");
}
