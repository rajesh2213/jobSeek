/**
 * Stricter filtering for careers_page candidate URLs before detail fetch + ingest.
 */

const JOBISH_PATH =
  /\/(job|jobs|career|careers|position|positions|opening|openings|role|roles|apply|vacanc|opportunit|requisition|req|detail)\b|\/r\d|jr[-_]?\d|req[-_]?\d|\/[a-z]{2}-[a-z]{2}\/job\//i;

export function isGarbageCareersHostPath(link: string): boolean {
  const l = link.toLowerCase();
  return (
    l.includes("spotify.com") ||
    l.includes("open.spotify.com") ||
    l.includes("docs.google.com") ||
    l.includes("linkedin.com") ||
    l.includes("twitter.com") ||
    l.includes("facebook.com") ||
    l.includes("instagram.com")
  );
}

/**
 * Returns true when URL should receive a detail fetch and may be a real posting.
 * Rejects obvious hubs, auth, search, category-only paths, and URLs with no job-like tokens.
 */
export function shouldFetchCareersJobDetail(link: string): boolean {
  if (!link.startsWith("http")) return false;
  if (isGarbageCareersHostPath(link)) return false;

  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return false;
  }

  const path = u.pathname;
  const lowPath = path.toLowerCase();
  const fullHint = `${lowPath}${u.search}`;

  if (
    /\/(login|signin|signup|sign-up|register|auth|oauth|callback)(\b|\/)/i.test(fullHint) ||
    /usernamerecovery|password|reset-password/i.test(fullHint)
  ) {
    return false;
  }

  if (/\/search\b/i.test(lowPath)) return false;

  if (
    /(life-at|life_at|culture|blog|news|developer-platform)/i.test(lowPath) ||
    /\/team\//i.test(lowPath) ||
    /\/about\//i.test(lowPath)
  ) {
    return false;
  }

  if (hostIsGoogleSites(u.hostname) && /signin|accounts\.google/i.test(u.href)) {
    return false;
  }

  if (/^\/careers\/?$/i.test(lowPath) || /^\/jobs\/?$/i.test(lowPath)) return false;
  if (/^\/[^/]+\/(careers|jobs)\/?$/i.test(lowPath)) return false;

  if (/\/careers\/tag\//i.test(lowPath)) return false;
  if (/\/categories\//i.test(lowPath)) return false;
  if (/\/career-area\/.+\/jobs\/?$/i.test(lowPath)) return false;

  if (
    /\/careers\/(engineering|sales|marketing|operations|product|design|finance|legal|people|hr|human-resources|support|customer-success|research|internships?|students?|university|early-career|early-talent|teams?|departments?)(\/|$)/i.test(
      lowPath,
    )
  ) {
    return false;
  }
  if (/\/jobs\/(engineering|sales|marketing|operations|product)(\/|$)/i.test(lowPath)) return false;

  if (/\/openings\/?$/i.test(lowPath) || /\/careers\/openings\/?$/i.test(lowPath)) return false;

  if (!JOBISH_PATH.test(fullHint)) return false;

  const segments = lowPath.split("/").filter(Boolean);
  const depth = segments.length;
  const lastSeg = segments[segments.length - 1] ?? "";
  const slugLike = lastSeg.length >= 10 && /[a-z0-9]+-[a-z0-9]+/i.test(lastSeg);

  if (
    depth < 3 &&
    !/\/job\//i.test(lowPath) &&
    !/apply/i.test(lowPath) &&
    !slugLike
  ) {
    return false;
  }

  return true;
}

function hostIsGoogleSites(host: string): boolean {
  return host.toLowerCase().includes("sites.google.com");
}

/**
 * Paths that are very unlikely to be job postings (align with validation URL penalties).
 * Used to skip self-heal retry on obvious non-job URLs.
 */
export function isStrongDenylistUrl(link: string): boolean {
  try {
    const u = new URL(link);
    const lowPath = u.pathname.toLowerCase();
    if (/(life-at|life_at|culture|blog|news|developer-platform)/i.test(lowPath)) return true;
    if (/\/team\//i.test(lowPath)) return true;
    if (/\/about\//i.test(lowPath)) return true;
    return false;
  } catch {
    return /(life-at|culture|blog|news|team|about|developer-platform)/i.test(link);
  }
}
