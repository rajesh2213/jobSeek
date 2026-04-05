/**
 * Extract public job listings from Wellfound company pages (HTML).
 */

const JOB_LINK_RE =
  /<a[^>]+href=["'](https:\/\/wellfound\.com\/(?:role|jobs)\/[^"']+)["'][^>]*>([^<]{1,320})<\/a>/gi;

const HREF_ONLY_RE =
  /href=["'](https:\/\/wellfound\.com\/(?:role|jobs)\/[^"']+)["']/gi;

export interface WellfoundListingRow {
  title: string;
  sourceUrl: string;
}

function normalizeWellfoundBase(url: string): string {
  const u = url.trim().replace(/\/$/, "");
  return u.startsWith("http") ? u : `https://${u}`;
}

/**
 * Parse job links + visible titles from company /jobs HTML.
 */
export function extractWellfoundListingsFromHtml(html: string): WellfoundListingRow[] {
  const out: WellfoundListingRow[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  JOB_LINK_RE.lastIndex = 0;
  while ((m = JOB_LINK_RE.exec(html)) !== null) {
    const sourceUrl = m[1]!.split("?")[0]!;
    const title = m[2]!.replace(/\s+/g, " ").trim() || "Job";
    if (seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);
    out.push({ title, sourceUrl });
  }

  if (out.length > 0) return out;

  HREF_ONLY_RE.lastIndex = 0;
  while ((m = HREF_ONLY_RE.exec(html)) !== null) {
    const sourceUrl = m[1]!.split("?")[0]!;
    if (seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);
    out.push({ title: "Job", sourceUrl });
  }

  return out;
}

/**
 * Try company URL and /jobs variant; return first HTML that looks like a jobs listing.
 */
export async function fetchWellfoundJobsHtml(wellfoundCompanyUrl: string): Promise<{
  html: string;
  fetchedUrl: string;
} | null> {
  const base = normalizeWellfoundBase(wellfoundCompanyUrl);
  const candidates = [base, `${base}/jobs`];

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(14_000),
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent":
            "Mozilla/5.0 (compatible; JobSeekBot/1.0; +https://example.com)",
        },
        redirect: "follow",
      });
      if (!res.ok) continue;
      const html = await res.text();
      if (/\/(role|jobs)\//i.test(html) || /wellfound\.com/i.test(html)) {
        return { html, fetchedUrl: url };
      }
    } catch {
      continue;
    }
  }
  return null;
}
