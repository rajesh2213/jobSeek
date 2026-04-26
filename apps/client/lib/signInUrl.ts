/**
 * Build `/sign-in` URL with a post-auth return path.
 * Uses the `next` query key (not `redirect_url`) so it does not collide with
 * Clerk’s own `redirect_url` handling during the sign-in / OAuth flow.
 */
export function signInWithNext(returnPath: string): string {
  const path = returnPath.startsWith("/") ? returnPath : `/${returnPath}`;
  return `/sign-in?next=${encodeURIComponent(path)}`;
}

/**
 * Same for sign-up (e.g. from Clerk’s link on the sign-in form).
 */
export function signUpWithNext(returnPath: string): string {
  const path = returnPath.startsWith("/") ? returnPath : `/${returnPath}`;
  return `/sign-up?next=${encodeURIComponent(path)}`;
}

function isSafeReturnPath(path: string): path is `/${string}` {
  return path.startsWith("/") && !path.startsWith("//");
}

/** Resolve `next` (or legacy `redirect_url`) from search params; default `/jobs`. */
export function returnPathFromSearchParams(
  get: (key: string) => string | null,
): `/${string}` {
  const raw = get("next") ?? get("redirect_url");
  if (raw == null) return "/jobs";
  let path: string;
  try {
    path = decodeURIComponent(raw);
  } catch {
    return "/jobs";
  }
  return isSafeReturnPath(path) ? path : "/jobs";
}
