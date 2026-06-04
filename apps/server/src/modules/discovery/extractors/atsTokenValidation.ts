/** Generic or path-segment tokens that must never become board slugs. */
export const INVALID_ATS_BOARD_TOKENS = new Set([
  "posting-api",
  "embed",
  "login",
  "jobs",
  "careers",
  "api",
  "job_board",
  "job-board",
  "external",
  "apply",
  "board",
  "company",
  "en",
  "www",
]);

/** Workday site path segments that are not job boards. */
export const INVALID_WORKDAY_SITES = new Set([
  "login",
  "signin",
  "sign-in",
  "introduceyourself",
  "external",
]);

const UUID_SLUG_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidBoardSlug(token: string | null | undefined): boolean {
  if (!token?.trim()) return false;
  return UUID_SLUG_RE.test(token.trim());
}

export function isInvalidAtsBoardToken(token: string | null | undefined): boolean {
  if (!token?.trim()) return true;
  const t = token.trim().toLowerCase();
  if (INVALID_ATS_BOARD_TOKENS.has(t)) return true;
  if (isUuidBoardSlug(t)) return true;
  if (t.length < 2) return true;
  return false;
}

export function normalizeBoardTokenRaw(token: string): string {
  let t = token.trim();
  try {
    t = decodeURIComponent(t);
  } catch {
    /* keep */
  }
  return t
    .replace(/['"”“]+/g, "")
    .replace(/\\+$/g, "")
    .trim()
    .toLowerCase();
}

export function sanitizeBoardToken(token: string | null | undefined): string | null {
  if (!token?.trim()) return null;
  const t = normalizeBoardTokenRaw(token);
  if (isInvalidAtsBoardToken(t)) return null;
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(t)) return null;
  return t;
}
