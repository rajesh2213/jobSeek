export interface SitemapUrlEntry {
  url: string;
  /** `unstable_cache` rehydrates Dates as ISO strings — accept both. */
  lastModified: Date | string;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatLastMod(date: Date | string): string {
  if (date instanceof Date) return date.toISOString();
  return new Date(date).toISOString();
}

export function buildUrlsetXml(entries: SitemapUrlEntry[]): string {
  const body = entries
    .map(
      (e) =>
        `  <url>\n    <loc>${escapeXml(e.url)}</loc>\n    <lastmod>${formatLastMod(e.lastModified)}</lastmod>\n  </url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function buildSitemapIndexXml(locations: string[], lastModified: Date): string {
  const lastmod = formatLastMod(lastModified);
  const body = locations
    .map(
      (loc) =>
        `  <sitemap>\n    <loc>${escapeXml(loc)}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </sitemap>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}
