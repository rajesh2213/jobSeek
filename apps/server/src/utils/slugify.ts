/**
 * URL-safe slug from company display name.
 * Uses the primary segment before a comma (e.g. "Stripe, Inc." → "stripe").
 */
export function slugifyCompanyName(name: string): string {
  const primary = name.split(",")[0]?.trim() ?? name.trim();
  const s = primary
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return s || "company";
}

/** @deprecated Use slugifyCompanyName for companies. */
export const slugifyName = slugifyCompanyName;
