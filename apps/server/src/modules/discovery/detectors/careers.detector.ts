import type { CareersDetectionResult } from "../discovery.types.js";

const CAREERS_PATHS = ["/careers", "/jobs", "/join-us", "/work-with-us"];

function normalizeDomain(domain: string): string {
  return domain.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

export async function detectCareersPage(domain: string): Promise<CareersDetectionResult> {
  const host = normalizeDomain(domain);

  for (const path of CAREERS_PATHS) {
    const candidate = `https://${host}${path}`;
    try {
      const res = await fetch(candidate, {
        signal: AbortSignal.timeout(5000),
        headers: { accept: "text/html" },
      });

      if (!res.ok) continue;

      const html = await res.text();
      const lower = html.toLowerCase();
      if (
        lower.includes("job") ||
        lower.includes("career") ||
        lower.includes("greenhouse.io") ||
        lower.includes("lever.co") ||
        lower.includes("ashbyhq.com")
      ) {
        return { careersUrl: candidate, html };
      }
    } catch {
      continue;
    }
  }

  return { careersUrl: null, html: null };
}
