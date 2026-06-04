import { extractBoardCandidateUrls } from "./extractBoardUrls.js";
import { sanitizeBoardToken } from "./atsTokenValidation.js";

function extractLeverSlugFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const parts = u.pathname.split("/").filter(Boolean);

    if (host.includes("lever.co")) {
      if (parts[0] === "jobs" && parts[1]) {
        return sanitizeBoardToken(parts[1]);
      }
      if (parts[0] === "v0" && parts[1] === "postings" && parts[2]) {
        return sanitizeBoardToken(parts[2]);
      }
      if (host === "jobs.lever.co" && parts[0]) {
        return sanitizeBoardToken(parts[0]);
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function extractLeverToken(html: string | null, careersUrl: string | null): string | null {
  const urls = extractBoardCandidateUrls(html, careersUrl);

  for (const url of urls) {
    const slug = extractLeverSlugFromUrl(url);
    if (slug) return slug;
  }

  const text = `${html ?? ""}\n${careersUrl ?? ""}`;

  for (const match of text.matchAll(/jobs\.lever\.co\/([a-z0-9][a-z0-9_-]*)/gi)) {
    const slug = sanitizeBoardToken(match[1] ?? "");
    if (slug) return slug;
  }

  for (const match of text.matchAll(
    /api\.lever\.co\/v0\/postings\/([a-z0-9][a-z0-9_-]*)/gi,
  )) {
    const slug = sanitizeBoardToken(match[1] ?? "");
    if (slug) return slug;
  }

  for (const match of text.matchAll(/apply\.lever\.co\/([a-z0-9][a-z0-9_-]*)/gi)) {
    const slug = sanitizeBoardToken(match[1] ?? "");
    if (slug) return slug;
  }

  for (const match of text.matchAll(
    /(?:postingOrgSlug|leverAccount|lever_company|accountName|companyId)["'\s:]+["']([a-z0-9][a-z0-9_-]*)["']/gi,
  )) {
    const slug = sanitizeBoardToken(match[1] ?? "");
    if (slug) return slug;
  }

  for (const match of text.matchAll(
    /data-(?:lever-)?(?:account|company|org)(?:-slug)?\s*=\s*["']([a-z0-9][a-z0-9_-]*)["']/gi,
  )) {
    const slug = sanitizeBoardToken(match[1] ?? "");
    if (slug) return slug;
  }

  return null;
}
