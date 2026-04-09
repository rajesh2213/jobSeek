/**
 * Scoring gate for careers_page HTML ingestion only (not ATS).
 */

export interface JobValidationInput {
  title: string | null;
  description: string | null;
  location?: string | null;
  sourceUrl: string;
  hasJsonLdJobPosting?: boolean;
}

export interface JobValidationResult {
  isValid: boolean;
  score: number;
  reasons: string[];
}

const JOB_LIKE_URL_RE = /(job|jobs|career|position|opening|req|jr|apply)/i;

function urlPathLooksNonJob(url: string): boolean {
  try {
    const p = new URL(url).pathname.toLowerCase();
    return (
      /(life-at|life_at|culture|blog|news|developer-platform)/i.test(p) ||
      /\/team\//i.test(p) ||
      /\/about\//i.test(p)
    );
  } catch {
    return /(life-at|culture|blog|news|team|about|developer-platform)/i.test(url);
  }
}

const MARKETING_PHRASES = /\b(join our team|life at|are you ready)\b/i;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Exported for unit tests and callers that share title rules. */
export function isJunkTitle(title: string): boolean {
  const t = title.trim();
  if (t.length < 4) return true;
  if (/^[a-zA-Z]{1,3}$/.test(t)) return true;
  const alnum = (t.match(/[a-zA-Z0-9]/g) ?? []).length;
  if (t.length > 0 && alnum / t.length < 0.7) return true;
  return false;
}

function pushReason(reasons: string[], code: string): void {
  if (!reasons.includes(code)) reasons.push(code);
}

/**
 * Score 0–100; isValid when score >= 50.
 */
export function validateJob(input: JobValidationInput): JobValidationResult {
  const reasons: string[] = [];
  let score = 0;

  const title = input.title?.trim() ?? "";
  const desc = input.description?.trim() ?? "";
  const loc = input.location?.trim() ?? "";
  const url = input.sourceUrl ?? "";

  if (input.hasJsonLdJobPosting) {
    score += 40;
    pushReason(reasons, "json_ld_jobposting");
  }

  if (title.length >= 5 && title.length <= 120) {
    score += 20;
    pushReason(reasons, "title_length_ok");
  } else if (title.length > 0) {
    pushReason(reasons, "title_length_bad");
    pushReason(reasons, "title_too_short");
  }

  if (desc.length > 300) {
    score += 15;
    pushReason(reasons, "description_length_ok");
  } else if (desc.length > 0) {
    pushReason(reasons, "description_too_short");
  }

  if (loc.length > 0) {
    score += 10;
    pushReason(reasons, "location_present");
  } else {
    pushReason(reasons, "location_missing");
  }

  if (url && JOB_LIKE_URL_RE.test(url)) {
    score += 10;
    pushReason(reasons, "url_job_pattern");
  }

  if (!desc) {
    score -= 30;
    pushReason(reasons, "description_missing");
    pushReason(reasons, "description_too_short");
  }

  if (!title || isJunkTitle(title)) {
    score -= 50;
    pushReason(reasons, "junk_title");
    if (!title.trim()) pushReason(reasons, "title_too_short");
  }

  if (url && urlPathLooksNonJob(url)) {
    score -= 30;
    pushReason(reasons, "url_non_job_pattern");
  }

  if (desc.length > 0 && desc.length < 200 && MARKETING_PHRASES.test(desc)) {
    score -= 20;
    pushReason(reasons, "marketing_snippet");
    pushReason(reasons, "marketing_content");
  }

  score = clamp(score, 0, 100);

  const isValid = score >= 50;

  return { isValid, score, reasons };
}

export function isCareersJobValidationEnabled(): boolean {
  return process.env.CAREERS_JOB_VALIDATION_ENABLED === "1";
}

export function isCareersJobSelfHealEnabled(): boolean {
  return process.env.CAREERS_JOB_SELF_HEAL === "1";
}
