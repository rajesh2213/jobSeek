// Extracts compact structured profile from resume text
// Uses rule-based extraction — no API calls
// Result stored as User.applyProfileSummary

import { SKILL_ALIAS_MAP } from "../config/taxonomy.js";

export interface ApplyProfileSummary {
  skills: string[];
  titles: string[];
  yearsExp: number | null;
  education: string[];
  highlights: string[]; // top 5 strongest bullet points
  wordCount: number;
}

const TITLE_WORDS =
  /\b(engineer|developer|manager|director|scientist|analyst|architect|designer|consultant|lead|specialist|coordinator|executive|researcher|programmer|administrator)\b/i;

const DEGREE_WORDS =
  /\b(bachelor|master|phd|doctorate|b\.s\.|m\.s\.|b\.e\.|m\.e\.|b\.tech|m\.tech|mba|degree|diploma|certificate)\b/i;

const EXP_YEARS_RE = /\b(\d{1,2})\+?\s*years?\s*(of\s*)?(experience|exp)\b/i;

const STRONG_VERBS =
  /^(led|built|designed|architected|developed|managed|created|launched|improved|reduced|increased|delivered|scaled|owned|drove|established|founded|grew|saved|automated|optimized|implemented|integrated|spearheaded|streamlined|enhanced|engineered)/i;

/** Filename segments that usually start the job-title suffix (not part of a person name). */
const TITLE_FILENAME_HINT =
  /\b(software|senior|junior|lead|principal|staff|engineer|developer|manager|analyst|architect|designer|consultant|specialist|scientist|programmer|intern|resume|cv|portfolio|fullstack|full[\s-]?stack|devops|sre|qa|data|product|frontend|backend|mobile)\b/i;

function normalizeResumeLine(line: string): string {
  return line.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
}

export function extractProfileSummary(
  resumeText: string,
  resumeBullets: string[],
): ApplyProfileSummary {
  const lines = resumeText
    .split("\n")
    .map((l) => normalizeResumeLine(l))
    .filter(Boolean);

  // Extract skills
  const resumeLower = resumeText.toLowerCase();
  const skills: string[] = [];
  for (const [alias, canonical] of Object.entries(SKILL_ALIAS_MAP)) {
    if (resumeLower.includes(alias.toLowerCase()) && !skills.includes(canonical)) {
      skills.push(canonical);
    }
  }

  // Extract job titles
  let titles = lines
    .filter((l) => TITLE_WORDS.test(l) && l.length < 80 && l.length > 5)
    .slice(0, 5);

  if (titles.length === 0) {
    const fallback = lines.find(
      (l) =>
        l.length >= 8 &&
        l.length <= 90 &&
        TITLE_FILENAME_HINT.test(l) &&
        !/@|https?:\/\//i.test(l),
    );
    if (fallback) titles = [fallback];
  }

  // Extract years of experience
  let yearsExp: number | null = null;
  for (const line of lines) {
    const m = line.match(EXP_YEARS_RE);
    if (m) {
      yearsExp = parseInt(m[1]!, 10);
      break;
    }
  }
  if (yearsExp == null) {
    const loose = resumeText.match(/\b(\d{1,2})\s*\+?\s*yrs?\b/i);
    if (loose) yearsExp = parseInt(loose[1]!, 10);
  }

  // Extract education
  const education = lines.filter((l) => DEGREE_WORDS.test(l) && l.length < 120).slice(0, 3);

  // Extract highlights — prefer strong-verb bullets; otherwise best long bullets
  const stripped = (b: string) => b.replace(/^[•\-–]\s*/, "").trim();
  const verbHits = resumeBullets
    .filter((b) => STRONG_VERBS.test(stripped(b)))
    .sort((a, b) => b.length - a.length);
  const highlights =
    verbHits.length > 0
      ? verbHits.slice(0, 5)
      : [...resumeBullets].sort((a, b) => b.length - a.length).slice(0, 5);

  return {
    skills: skills.slice(0, 20),
    titles,
    yearsExp,
    education,
    highlights,
    wordCount: resumeText.split(/\s+/).filter(Boolean).length,
  };
}

const MAX_INFERRED_SUMMARY = 4000;

/** Single name token: letters (any script), hyphens, apostrophes, periods (initials). */
const NAME_TOKEN = /^[\p{L}][\p{L}'.-]*$/u;

/** Heuristic name from first lines of resume header (best-effort). PDF order can be messy — filename fallback helps. */
function inferNameFromResumeHeader(text: string): { firstName: string; lastName: string } | null {
  const lines = text
    .split("\n")
    .map((l) => normalizeResumeLine(l))
    .filter(Boolean)
    .slice(0, 24);

  for (const line of lines) {
    if (line.length < 4 || line.length > 96) continue;
    if (
      /@|https?:\/\/|www\.|linkedin\.|github\.com|^\s*\||\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/i.test(
        line,
      )
    ) {
      continue;
    }
    if (/^(resume|cv|curriculum|phone|email|mobile|address|tel)/i.test(line)) continue;
    const parts = line.split(/\s+/).filter(Boolean);
    if (parts.length < 2 || parts.length > 5) continue;
    const allNameLike = parts.every((p) => NAME_TOKEN.test(p));
    if (!allNameLike) continue;
    return {
      firstName: parts[0]!.slice(0, 80),
      lastName: parts.slice(1).join(" ").slice(0, 120),
    };
  }
  return null;
}

/**
 * Parse `First_Last_Role` style filenames (common export pattern) when header text is unreliable.
 * Example: `Raajeshvaran_M_Software_Engineer.pdf` → first / last before the job-title segment.
 */
function inferNameFromFileName(fileName: string): { firstName: string; lastName: string } | null {
  const base = fileName.replace(/\.(pdf|docx?|txt)$/i, "").trim();
  if (base.length < 3 || base.length > 120) return null;
  const parts = base.split(/[_\s-]+/).map((p) => normalizeResumeLine(p)).filter(Boolean);
  if (parts.length < 2) return null;
  let cut = parts.length;
  for (let i = 0; i < parts.length; i++) {
    if (TITLE_FILENAME_HINT.test(parts[i])) {
      cut = i;
      break;
    }
  }
  if (cut < 2) return null;
  const nameParts = parts.slice(0, cut);
  if (nameParts.length > 5) return null;
  const firstName = nameParts[0]!.slice(0, 80);
  const lastName = nameParts.slice(1).join(" ").slice(0, 120);
  if (!NAME_TOKEN.test(firstName)) return null;
  return { firstName, lastName };
}

function inferSummaryFromResumeBody(text: string): string | null {
  const lines = text
    .split("\n")
    .map((l) => normalizeResumeLine(l))
    .filter(Boolean);
  const body = lines
    .filter(
      (l) =>
        l.length > 45 &&
        l.length < 400 &&
        !/^[A-Z0-9\s|]{3,40}$/.test(l) &&
        !/@|https?:\/\//i.test(l),
    )
    .slice(0, 4);
  if (body.length === 0) return null;
  return body.map((l) => `• ${l}`).join("\n").slice(0, MAX_INFERRED_SUMMARY);
}

export interface InferredApplyFields {
  firstName?: string;
  lastName?: string;
  currentTitle?: string;
  yearsOfExperience?: number;
  professionalSummary?: string;
}

export type InferApplyFieldsOptions = {
  /** Original upload filename — used to recover name/title when PDF text order is noisy. */
  fileName?: string;
};

/**
 * Suggested apply-profile fields from resume text + extractProfileSummary.
 * Only fills when merged into empty DB fields by the caller.
 */
export function inferApplyFieldsFromResume(
  resumeText: string,
  summary: ApplyProfileSummary,
  options?: InferApplyFieldsOptions,
): InferredApplyFields {
  const out: InferredApplyFields = {};
  let name = inferNameFromResumeHeader(resumeText);
  if (!name && options?.fileName) {
    name = inferNameFromFileName(options.fileName);
  }
  if (name) {
    out.firstName = name.firstName;
    out.lastName = name.lastName;
  }
  let title0 = summary.titles[0]?.trim();
  if (!title0 && options?.fileName) {
    const t = inferTitleFromFileName(options.fileName);
    if (t) title0 = t;
  }
  if (title0) {
    out.currentTitle = title0.slice(0, 200);
  }
  if (summary.yearsExp != null) {
    out.yearsOfExperience = summary.yearsExp;
  }
  if (summary.highlights.length > 0) {
    out.professionalSummary = summary.highlights
      .map((h) => `• ${h.replace(/^[•\-–]\s*/, "").trim()}`)
      .join("\n")
      .slice(0, MAX_INFERRED_SUMMARY);
  } else {
    const fromBody = inferSummaryFromResumeBody(resumeText);
    if (fromBody) out.professionalSummary = fromBody;
  }
  return out;
}

/** Job title segment after name tokens in e.g. `Name_Last_Software_Engineer.pdf`. */
function inferTitleFromFileName(fileName: string): string | null {
  const base = fileName.replace(/\.(pdf|docx?|txt)$/i, "").trim();
  const parts = base.split(/[_\s-]+/).map((p) => normalizeResumeLine(p)).filter(Boolean);
  if (parts.length < 3) return null;
  let cut = parts.length;
  for (let i = 0; i < parts.length; i++) {
    if (TITLE_FILENAME_HINT.test(parts[i])) {
      cut = i;
      break;
    }
  }
  const titleParts = parts.slice(cut);
  if (titleParts.length === 0) return null;
  const title = titleParts.join(" ").replace(/\s+/g, " ").trim();
  return title.length > 2 && title.length <= 200 ? title : null;
}

function isEmptyStr(v: string | null | undefined): boolean {
  return v == null || String(v).trim() === "";
}

function trimUrlTail(u: string): string {
  return u.replace(/[.,;)\]>'"]+$/g, "").trim();
}

function ensureHttpUrl(raw: string): string {
  const t = trimUrlTail(raw);
  if (!t) return t;
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/**
 * Deterministic LinkedIn / GitHub / portfolio URLs from raw resume text.
 * PDFs often omit hyperlinks in parsed text; the LLM may still miss bare domains.
 * Used by extract-profile before the optional Claude pass.
 */
export function inferSocialUrlsFromResume(resumeText: string): {
  linkedinUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
} {
  const out: { linkedinUrl?: string; githubUrl?: string; portfolioUrl?: string } = {};
  const flat = resumeText.replace(/\u00a0/g, " ");

  const li =
    flat.match(/https?:\/\/(?:[\w-]+\.)?linkedin\.com\/[^\s\])"'<>]+/i) ??
    flat.match(/\blinkedin\.com\/[^\s\])"'<>]+/i);
  if (li?.[0]) out.linkedinUrl = ensureHttpUrl(li[0]).slice(0, 500);

  const gh =
    flat.match(/https?:\/\/(?:www\.)?github\.com\/[^\s\])"'<>]+/i) ??
    flat.match(/\bgithub\.com\/[^\s\])"'<>]+/i);
  if (gh?.[0]) out.githubUrl = ensureHttpUrl(gh[0]).slice(0, 500);

  const labeledHttps = flat.match(
    /(?:^|[\n\r])[\s•\-–]*(?:Portfolio|Personal\s*(?:web)?site|Website|Blog)\s*[:]\s*(https?:\/\/\S+)/im,
  );
  if (labeledHttps?.[1]) {
    out.portfolioUrl = trimUrlTail(labeledHttps[1]).slice(0, 500);
  } else {
    const labeledBare = flat.match(
      /(?:^|[\n\r])[\s•\-–]*(?:Portfolio|Personal\s*(?:web)?site|Website|Blog)\s*[:]\s*(\S+)/im,
    );
    if (labeledBare?.[1] && /^https?:\/\//i.test(labeledBare[1])) {
      out.portfolioUrl = trimUrlTail(labeledBare[1]).slice(0, 500);
    }
  }

  if (!out.portfolioUrl) {
    for (const m of flat.matchAll(/https?:\/\/[^\s\])"'<>]+/gi)) {
      const u = trimUrlTail(m[0]);
      if (u.length < 12 || u.length > 500) continue;
      if (
        /linkedin\.com|github\.com|mailto:|google\.com\/maps|goo\.gl|localhost/i.test(
          u,
        )
      ) {
        continue;
      }
      out.portfolioUrl = u;
      break;
    }
  }

  return out;
}

/**
 * Merge inferred fields only where existing is null/empty.
 */
export function mergeInferredApplyFields(
  existing: {
    firstName: string | null;
    lastName: string | null;
    currentTitle: string | null;
    yearsOfExperience: number | null;
    professionalSummary: string | null;
  },
  inferred: InferredApplyFields,
): Partial<{
  firstName: string;
  lastName: string;
  currentTitle: string;
  yearsOfExperience: number;
  professionalSummary: string;
}> {
  const merged: Partial<{
    firstName: string;
    lastName: string;
    currentTitle: string;
    yearsOfExperience: number;
    professionalSummary: string;
  }> = {};
  if (isEmptyStr(existing.firstName) && inferred.firstName) merged.firstName = inferred.firstName;
  if (isEmptyStr(existing.lastName) && inferred.lastName) merged.lastName = inferred.lastName;
  if (isEmptyStr(existing.currentTitle) && inferred.currentTitle) merged.currentTitle = inferred.currentTitle;
  if (existing.yearsOfExperience == null && inferred.yearsOfExperience != null) {
    merged.yearsOfExperience = inferred.yearsOfExperience;
  }
  if (isEmptyStr(existing.professionalSummary) && inferred.professionalSummary) {
    merged.professionalSummary = inferred.professionalSummary;
  }
  return merged;
}

export type ProfileContextExtras = {
  languages?: string | null;
  certifications?: string | null;
  highestEducation?: string | null;
  currentCompensation?: string | null;
  noticePeriod?: string | null;
  relocationPreference?: string | null;
  remotePreference?: string | null;
};

export function buildPromptContext(
  profile: ApplyProfileSummary,
  firstName: string,
  lastName: string,
  currentTitle: string | null,
  professionalSummary: string | null,
  workAuth: string | null,
  salary: string | null,
  availability: string | null,
  customQA: Array<{ question: string; answer: string }>,
  extras?: ProfileContextExtras | null,
): string {
  const qaText =
    customQA.length > 0
      ? "\nPre-written answers:\n" +
        customQA.map((qa) => `Q: ${qa.question}\nA: ${qa.answer}`).join("\n\n")
      : "";

  const x = extras ?? {};
  const extraLines: string[] = [];
  if (x.languages?.trim()) extraLines.push(`Languages: ${x.languages.trim()}`);
  if (x.certifications?.trim()) extraLines.push(`Certifications: ${x.certifications.trim()}`);
  if (x.currentCompensation?.trim()) extraLines.push(`Current compensation: ${x.currentCompensation.trim()}`);
  if (x.noticePeriod?.trim()) extraLines.push(`Notice period: ${x.noticePeriod.trim()}`);
  if (x.relocationPreference?.trim()) extraLines.push(`Relocation: ${x.relocationPreference.trim()}`);
  if (x.remotePreference?.trim()) extraLines.push(`Remote preference: ${x.remotePreference.trim()}`);
  const extraBlock = extraLines.length > 0 ? `\n${extraLines.join("\n")}` : "";

  return `Candidate: ${firstName} ${lastName}
Title: ${currentTitle ?? profile.titles[0] ?? "Not specified"}
Experience: ${profile.yearsExp ?? "Not specified"} years
Skills: ${profile.skills.slice(0, 12).join(", ")}
Education: ${x.highestEducation?.trim() || profile.education[0] || "Not specified"}${extraBlock}
Work authorization: ${workAuth ?? "Not specified"}
Salary expectation: ${salary ?? "Not specified"}
Available: ${availability ?? "Not specified"}
Summary: ${professionalSummary ?? "Not specified"}
Key achievements:
${profile.highlights.slice(0, 3).map((h) => `• ${h}`).join("\n")}
${qaText}`;
}
