import { extractBoardCandidateUrls } from "./extractBoardUrls.js";
import { sanitizeBoardToken } from "./atsTokenValidation.js";

function ashbySlug(raw: string | null | undefined): string | null {
  return sanitizeBoardToken(raw);
}

/**
 * Ashby org slug from jobs.ashbyhq.com/{slug} or job-board/{slug} in API URLs.
 * Never returns "posting-api" (API path segment, not org id).
 */
export function extractAshbyToken(html: string | null, careersUrl: string | null): string | null {
  const urls = extractBoardCandidateUrls(html, careersUrl);

  for (const url of urls) {
    const fromJobs = extractAshbySlugFromUrl(url);
    if (fromJobs) return fromJobs;
  }

  const blob = `${html ?? ""}\n${careersUrl ?? ""}`;

  for (const match of blob.matchAll(/jobs\.ashbyhq\.com\/([a-z0-9][a-z0-9_-]*)/gi)) {
    const slug = ashbySlug(match[1]);
    if (slug) return slug;
  }

  for (const match of blob.matchAll(/job-board\/([a-z0-9][a-z0-9_-]*)/gi)) {
    const slug = ashbySlug(match[1]);
    if (slug) return slug;
  }

  for (const match of blob.matchAll(
    /app\.ashbyhq\.com\/([a-z0-9][a-z0-9_-]*)(?:\/|$|\?)/gi,
  )) {
    const slug = ashbySlug(match[1]);
    if (slug) return slug;
  }

  for (const match of blob.matchAll(
    /(?:ashbyBaseJobBoardUrl|ashby_org|organizationSlug)["'\s:]+["']https?:\/\/jobs\.ashbyhq\.com\/([a-z0-9_-]+)["']/gi,
  )) {
    const slug = ashbySlug(match[1]);
    if (slug) return slug;
  }

  for (const match of blob.matchAll(
    /(?:ashbyBaseJobBoardUrl|ashby_org|organizationSlug)["'\s:]+["']([a-z0-9][a-z0-9_-]*)["']/gi,
  )) {
    const slug = ashbySlug(match[1]);
    if (slug) return slug;
  }

  return null;
}

function extractAshbySlugFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const parts = u.pathname.split("/").filter(Boolean);

    if (host === "jobs.ashbyhq.com" && parts[0]) {
      return ashbySlug(parts[0]);
    }

    if (host.includes("ashbyhq.com") && parts[0] === "jobs" && parts[1]) {
      return ashbySlug(parts[1]);
    }

    if (host === "app.ashbyhq.com" && parts[0]) {
      return ashbySlug(parts[0]);
    }

    const jbIdx = parts.indexOf("job-board");
    if (jbIdx >= 0 && parts[jbIdx + 1]) {
      return ashbySlug(parts[jbIdx + 1]);
    }

    if (parts.includes("posting-api")) {
      return null;
    }
  } catch {
    return null;
  }
  return null;
}
