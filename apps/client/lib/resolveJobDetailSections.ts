import type { JobItem, ParsedJobDescription } from "./api";
import { parseJobDescription } from "./jobDescriptionParser";

const KEYS: (keyof ParsedJobDescription)[] = [
  "position",
  "responsibility",
  "requirement",
  "experience",
  "benefit",
  "contact",
  "other",
];

/** UI / SEO section order (role overview / position is intentionally omitted). */
export const DISPLAY_SECTION_KEYS = [
  "responsibility",
  "requirement",
  "experience",
  "benefit",
  "contact",
  "other",
] as const satisfies readonly (keyof ParsedJobDescription)[];

export type DisplaySectionKey = (typeof DISPLAY_SECTION_KEYS)[number];

const MIN_STANDARD_LINE = 12;
const MIN_CONTACT_LINE = 16;
const MIN_OTHER_LINE = 28;
const MIN_OTHER_SECTION_CHARS = 100;
const MAX_OTHER_LINES = 10;

function emptyBuckets(): ParsedJobDescription {
  return {
    position: [],
    responsibility: [],
    requirement: [],
    experience: [],
    benefit: [],
    contact: [],
    other: [],
  };
}

function normalizeAiJson(raw: unknown): ParsedJobDescription | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const out = emptyBuckets();
  for (const k of KEYS) {
    const v = o[k];
    if (!Array.isArray(v)) continue;
    out[k] = v
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return out;
}

function hasAnyContent(p: ParsedJobDescription): boolean {
  return KEYS.some((k) => p[k].length > 0);
}

function filterStandardLines(lines: string[], minLen: number): string[] {
  return lines
    .map((s) => s.trim())
    .filter((s) => {
      if (s.length < minLen) return false;
      if (/^(overview|summary|introduction|role|title)\s*:?\s*$/i.test(s)) return false;
      return true;
    });
}

function filterContactLines(lines: string[]): string[] {
  return lines
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_CONTACT_LINE && /[@./:\d]/.test(s));
}

/** Keep "Additional details" only when lines are substantive (avoid dump bucket). */
function filterMeaningfulOther(lines: string[]): string[] {
  const filtered = lines
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_OTHER_LINE);
  if (!filtered.length) return [];
  const text = filtered.join(" ");
  if (text.length < MIN_OTHER_SECTION_CHARS && filtered.length < 2) return [];
  return filtered.slice(0, MAX_OTHER_LINES);
}

/**
 * Drop weak lines and noisy buckets for display + stable SEO snippets.
 * Never surfaces `position` (role overview); merge that content is intentionally excluded.
 */
export function refineSectionsForDisplay(sections: ParsedJobDescription): ParsedJobDescription {
  const out = emptyBuckets();
  out.responsibility = filterStandardLines(sections.responsibility, MIN_STANDARD_LINE);
  out.requirement = filterStandardLines(sections.requirement, MIN_STANDARD_LINE);
  out.experience = filterStandardLines(sections.experience, MIN_STANDARD_LINE);
  out.benefit = filterStandardLines(sections.benefit, MIN_STANDARD_LINE);
  out.contact = filterContactLines(sections.contact);
  out.other = filterMeaningfulOther(sections.other);
  out.position = [];
  return out;
}

/**
 * Prefer API `parsedDescription` (AI). If missing/empty, use heuristic line parser, then minimal raw fallback.
 */
export function resolveJobDetailSections(job: JobItem): ParsedJobDescription {
  const fromApi = normalizeAiJson(job.parsedDescription);
  if (fromApi && hasAnyContent(fromApi)) {
    return fromApi;
  }

  const desc = job.description?.trim() ?? "";
  const h = parseJobDescription(desc || null);
  const merged = emptyBuckets();
  merged.responsibility = [...h.responsibilities];
  merged.requirement = [...h.requirements];
  merged.benefit = [...h.benefits];
  merged.other = [...h.others];
  if (h.intro) merged.other = [h.intro, ...merged.other];

  if (hasAnyContent(merged)) {
    return merged;
  }

  if (desc.length >= 3) {
    merged.other = [desc];
  }
  return merged;
}

export function sectionsPlainTextForSeo(sections: ParsedJobDescription): string {
  const parts: string[] = [];
  for (const k of DISPLAY_SECTION_KEYS) {
    for (const line of sections[k]) {
      parts.push(line);
    }
  }
  return parts.join("\n").trim();
}
