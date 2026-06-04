/**
 * Collect absolute URLs from careers HTML for board slug extraction.
 */
export function extractBoardCandidateUrls(html: string | null, careersUrl: string | null): string[] {
  const out = new Set<string>();
  if (careersUrl?.trim()) out.add(careersUrl.trim());

  if (!html) return [...out];

  const hrefRe = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;
  const srcRe = /<(?:script|iframe)\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  const dataUrlRe =
    /\bdata-(?:href|url|src|board-url)\s*=\s*["']([^"']+)["']/gi;

  for (const re of [hrefRe, srcRe, dataUrlRe]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const raw = m[1]?.trim();
      if (!raw || raw.startsWith("#") || raw.startsWith("javascript:")) continue;
      try {
        if (/^https?:\/\//i.test(raw)) out.add(raw);
        else if (raw.startsWith("//")) out.add(`https:${raw}`);
        else if (careersUrl?.trim()) out.add(new URL(raw, careersUrl).toString());
      } catch {
        /* skip */
      }
    }
  }

  for (const match of html.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
    const u = match[0]?.trim();
    if (u) out.add(u);
  }

  return [...out];
}
