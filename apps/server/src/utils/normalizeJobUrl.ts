export function normalizeJobUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    const normalized = u.toString().toLowerCase();
    return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  } catch {
    return url
      .toLowerCase()
      .split("?")[0]
      ?.replace(/\/$/, "") ?? "";
  }
}
