/**
 * Mirrors client `filtersToSlug` in `apps/client/lib/slug-parser.ts` — keep in sync.
 */
function toSlugToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function filtersToJobListingSlug(filters: {
  category?: string;
  role?: string;
  skills?: string[];
  country?: string;
  isRemote?: boolean;
  workType?: "remote" | "onsite" | "hybrid";
  experience?: "junior" | "mid" | "senior";
}): string {
  const parts: string[] = [];
  if (filters.role) parts.push("role", toSlugToken(filters.role));
  if (filters.category) parts.push("category", toSlugToken(filters.category));
  if (filters.skills?.length) parts.push("skill", toSlugToken(filters.skills[0] ?? ""));
  if (filters.country) parts.push("location", filters.country.toLowerCase());
  else if (filters.workType === "remote" || filters.isRemote) parts.push("location", "remote");
  if (filters.workType && filters.workType !== "remote") parts.push("work-type", filters.workType);
  if (filters.experience === "junior") parts.push("experience", "0-2-years");
  if (filters.experience === "mid") parts.push("experience", "3-5-years");
  if (filters.experience === "senior") parts.push("experience", "6-plus-years");
  return parts.join("/");
}
