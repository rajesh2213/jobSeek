import { extractBoardCandidateUrls } from "./extractBoardUrls.js";
import { isInvalidAtsBoardToken, sanitizeBoardToken } from "./atsTokenValidation.js";

/**
 * Greenhouse board token from boards.greenhouse.io/{token} or embed ?for={token}.
 * Never returns "embed" (URL path segment, not board id).
 */
export function extractGreenhouseToken(html: string | null, careersUrl: string | null): string | null {
  const urls = extractBoardCandidateUrls(html, careersUrl);

  for (const url of urls) {
    const token = extractGreenhouseTokenFromUrl(url);
    if (token) return token;
  }

  const blob = `${html ?? ""}\n${careersUrl ?? ""}`;

  for (const match of blob.matchAll(
    /(?:boards|job-boards)\.greenhouse\.io\/([a-z0-9][a-z0-9_-]*)/gi,
  )) {
    const slug = sanitizeBoardToken(match[1] ?? "");
    if (slug) return slug;
  }

  const forMatch = blob.match(/greenhouse\.io\/embed\/job_board[^"']*[?&]for=([a-z0-9_-]+)/i);
  if (forMatch?.[1]) {
    return sanitizeBoardToken(forMatch[1]);
  }

  for (const match of blob.matchAll(
    /(?:boardToken|board_token|grnhse_board|gh_board_id|job_board_id)["'\s:]+["']([a-z0-9][a-z0-9_-]*)["']/gi,
  )) {
    const slug = sanitizeBoardToken(match[1] ?? "");
    if (slug) return slug;
  }

  for (const match of blob.matchAll(/grnhse_settings\s*=\s*(\{[\s\S]{0,800}?\})/gi)) {
    const block = match[1] ?? "";
    const board = block.match(/board_token["'\s:]+["']([a-z0-9_-]+)["']/i);
    if (board?.[1]) {
      const slug = sanitizeBoardToken(board[1]);
      if (slug) return slug;
    }
  }

  return null;
}

export function extractGreenhouseTokenFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (!host.includes("greenhouse.io")) return null;

    const parts = u.pathname.split("/").filter(Boolean);

    if (parts[0] === "embed" && parts[1] === "job_board") {
      const q = u.searchParams.get("for");
      return sanitizeBoardToken(q);
    }

    if (parts[0] === "boards" && parts[1]) {
      return sanitizeBoardToken(parts[1]);
    }

    if (host.startsWith("boards.") || host.startsWith("job-boards.")) {
      if (parts[0] && !isInvalidAtsBoardToken(parts[0])) {
        return sanitizeBoardToken(parts[0]);
      }
    }
  } catch {
    return null;
  }
  return null;
}
