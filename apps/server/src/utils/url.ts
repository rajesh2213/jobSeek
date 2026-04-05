/**
 * Validate URLs persisted as listing / apply links.
 * Rejects relative paths, placeholders, and known-bad patterns.
 */
export function isValidJobUrl(url: string | undefined | null): boolean {
  if (!url || typeof url !== "string") return false;
  const t = url.trim();
  if (!t) return false;
  const lower = t.toLowerCase();
  if (!lower.startsWith("http://") && !lower.startsWith("https://")) return false;
  if (lower.includes("invalid-url")) return false;
  if (lower.includes("/invalid")) return false;
  try {
    const u = new URL(t);
    return Boolean(u.hostname);
  } catch {
    return false;
  }
}
