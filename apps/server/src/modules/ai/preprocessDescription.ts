import he from "he";

const JUNK_LINE =
  /\b(cookie|cookies)\b|\bprivacy\b|\bsign\s+in\b|\bsearch\s+by\b|\ball\s+rights\s+reserved\b/i;

const MIN_LINE = 20;
/** Must stay ≤ inference tokenizer `max_length` (see apps/inference/app.py, default 512). */
export const MAX_PREPROCESS_LINE_CHARS = 512;
const MAX_LINE = MAX_PREPROCESS_LINE_CHARS;

/** Use smart `. ` splits only on dense blobs above this length (no inline bullets). */
const DENSE_PARAGRAPH_MIN = 200;

/** Fragments at most this length may be rejoined with the previous line. */
const ORPHAN_MAX_LEN = 34;

const SECTION_HEADINGS_BASE = [
  "What You Will Need",
  "What You'll Need",
  "What You Will Do",
  "What You'll Do",
  "About the Role",
  "Key Responsibilities",
  "Bonus Points",
  "Qualifications",
  "Responsibilities",
  "Requirements",
  "Experience",
  "Benefits",
  "Your Impact",
] as const;

const SECTION_HEADINGS: string[] = [...SECTION_HEADINGS_BASE].sort(
  (a, b) => b.length - a.length,
);

/** Standalone qualification section lines → insert [REQUIREMENTS] before them. */
const QUALIFICATION_STANDALONE_LINE_RE =
  /^\s*(?:qualifications?:?|required\s+skills?:?|competencies:?)\s*$/i;

/**
 * Company / culture boilerplate: substring hits get `[OTHER]` prefix for the whole line.
 */
const COMPANY_BOILERPLATE_RE = new RegExp(
  [
    "\\bvirtually every electronic device\\b",
    "we invest\\s+\\d+\\s*%\\s+of",
    "\\blife here is exciting\\b",
    "\\bwould have made it into your hands\\b",
    "\\b[A-Z][\\w&.-]{2,48}\\s+is a global leader\\b",
    "\\b[A-Z][\\w&.-]{2,48}\\s+is a leading\\b",
    "\\b[A-Z][\\w&.-]{2,48}\\s+focuses on\\b",
    "^\\s*[A-Z][a-zA-Z\\s]{1,120}?\\s+is a\\s+(?:global|leading|premier|world-class|fast-growing)\\b",
    "\\bis the\\s+(?:fastest|largest|best|most|number\\s*#?\\s*1)\\b",
    "\\branks as the number\\b",
    "\\bexamples of customer success include\\b",
  ].join("|"),
  "i",
);

/** Same detector as preprocess `[OTHER]` hints; used to re-bucket model mislabels. */
export function lineMatchesCompanyBoilerplate(line: string): boolean {
  const core = line.replace(/^\s*\[(?:OTHER|REQUIREMENTS)\]\s*/gi, "").trim();
  return COMPANY_BOILERPLATE_RE.test(core);
}

/** Word before `.` must not be a known abbreviation when splitting on `. `. */
const SENTENCE_ABBREVS = new Set([
  "sr",
  "jr",
  "dr",
  "ms",
  "mr",
  "mrs",
  "vs",
  "ie",
  "eg",
  "etc",
  "inc",
  "ltd",
  "corp",
  "st",
  "ave",
  "blvd",
  "approx",
  "fig",
  "al",
  "us",
  "uk",
  "phd",
  "bs",
  "ms",
  "ba",
  "ma",
  "am",
  "pm",
]);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function insertHeadingBreaks(text: string): string {
  let t = text;
  t = t.replace(/(\s|^)(You will)(?=\s*:)/gi, "\n$2");
  for (const h of SECTION_HEADINGS) {
    const re = new RegExp(`(\\s|^)(${escapeRegex(h)})(?=\\s|:|$)`, "gi");
    t = t.replace(re, "\n$2");
  }
  return t;
}

function normalizeRaw(description: string): string {
  let t = he.decode(description);
  t = t.replace(/<br\s*\/?>/gi, "\n");
  t = t.replace(/<\/p\s*>/gi, "\n");
  t = t.replace(/<p[^>]*>/gi, "\n");
  t = t.replace(/<li[^>]*>/gi, "\n• ");
  t = t.replace(/<[^>]+>/g, " ");
  t = t.replace(/\u00a0/g, " ");
  t = t.replace(/[ \t\f\v]+/g, " ");
  return t.trim();
}

function cleanLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function hasInlineBullet(s: string): boolean {
  return /[•·\u2022]/.test(s) || /\*\s+\S/.test(s);
}

/** Last word token immediately before `periodIdx` (the `.` of `. `). */
function wordBeforePeriod(text: string, periodIdx: number): string {
  let i = periodIdx - 1;
  while (i >= 0 && /\s/.test(text[i])) i--;
  if (i < 0) return "";
  const end = i;
  while (i >= 0 && /[\w'-]/i.test(text[i])) i--;
  return text.slice(i + 1, end + 1);
}

function isAbbrevBeforePeriod(wordRaw: string): boolean {
  const w = wordRaw.replace(/\.$/, "").toLowerCase();
  if (!w) return false;
  if (SENTENCE_ABBREVS.has(w)) return true;
  const parts = w.split(/[^a-z0-9]+/i).filter(Boolean);
  const last = parts[parts.length - 1] ?? w;
  if (SENTENCE_ABBREVS.has(last)) return true;
  if (parts.length >= 2) {
    const a = parts[parts.length - 2] ?? "";
    const b = parts[parts.length - 1] ?? "";
    if ((a === "i" && b === "e") || (a === "e" && b === "g")) return true;
  }
  return false;
}

/**
 * Split on `. ` only when the next word starts with A–Z and the token before `.` is not a known abbreviation.
 */
function splitDenseSentenceBoundaries(text: string): string[] {
  const t = text.trim();
  if (!t) return [];

  const parts: string[] = [];
  let start = 0;
  let searchFrom = 0;

  while (searchFrom < t.length) {
    const dotSpace = t.indexOf(". ", searchFrom);
    if (dotSpace === -1) break;

    const rest = t.slice(dotSpace + 2);
    const cap = rest.match(/^\s*([A-Z])/);
    if (!cap) {
      searchFrom = dotSpace + 2;
      continue;
    }

    const before = wordBeforePeriod(t, dotSpace);
    if (isAbbrevBeforePeriod(before)) {
      searchFrom = dotSpace + 2;
      continue;
    }

    const chunk = t.slice(start, dotSpace + 1).trim();
    if (chunk) parts.push(chunk);
    start = dotSpace + 2;
    searchFrom = dotSpace + 2;
  }

  const tail = t.slice(start).trim();
  if (tail) parts.push(tail);

  return parts.length > 0 ? parts : [t];
}

function sentenceSplitLegacy(s: string): string[] {
  return s
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Split inline bullets (leave hyphenated phrases intact; ATS uses • or * lists). */
function bulletSplit(segment: string): string[] {
  return segment
    .split(/\s*[•·\u2022]\s*|\s*\*\s+/)
    .map((p) => cleanLine(p))
    .filter(Boolean);
}

function truncateToMax(s: string): string {
  if (s.length <= MAX_LINE) return s;
  const slice = s.slice(0, MAX_LINE);
  const cut = slice.lastIndexOf(" ");
  return (cut > MIN_LINE ? slice.slice(0, cut) : slice).trim();
}

function expandSegment(segment: string): string[] {
  const base = cleanLine(segment);
  if (!base || JUNK_LINE.test(base)) return [];
  if (base.length < MIN_LINE) {
    return [base];
  }

  let chunks: string[];
  if (base.length > DENSE_PARAGRAPH_MIN && !hasInlineBullet(base)) {
    chunks = splitDenseSentenceBoundaries(base);
  } else {
    chunks = [base];
  }

  const out: string[] = [];
  for (const chunk of chunks) {
    const c = cleanLine(chunk);
    if (!c || JUNK_LINE.test(c)) continue;

    if (c.length > MAX_LINE) {
      const sub = splitDenseSentenceBoundaries(c);
      if (sub.length > 1) {
        for (const s of sub) {
          out.push(...expandSegment(s));
        }
        continue;
      }
      const legacy = sentenceSplitLegacy(c);
      if (legacy.length > 1) {
        for (const s of legacy) {
          out.push(...expandSegment(s));
        }
        continue;
      }
      const t = truncateToMax(c);
      if (t.length >= MIN_LINE && !JUNK_LINE.test(t)) out.push(t);
      continue;
    }

    if (c.length < MIN_LINE) {
      out.push(c);
      continue;
    }

    out.push(c);
  }

  return out;
}

function isOrphanFragment(line: string): boolean {
  const t = line.trim();
  if (t.length > ORPHAN_MAX_LEN) return false;
  if (/^experience of\b/i.test(t)) return true;
  if (/^years of\b/i.test(t)) return true;
  if (/^years in\b/i.test(t)) return true;
  if (/^and related\b/i.test(t)) return true;
  if (/^[a-z]/.test(t)) return true;
  return false;
}

function rejoinOrphanFragments(lines: string[]): string[] {
  if (lines.length === 0) return [];
  const out: string[] = [];
  for (const line of lines) {
    if (out.length > 0 && isOrphanFragment(line)) {
      out[out.length - 1] = cleanLine(out[out.length - 1] + " " + line);
    } else {
      out.push(line);
    }
  }
  return out;
}

/** Dense splits can yield valid sentences under MIN_LINE; attach them to the previous line. */
function rejoinShortTailLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (QUALIFICATION_STANDALONE_LINE_RE.test(t)) {
      out.push(line);
      continue;
    }
    if (/^\[REQUIREMENTS\]\s*$/i.test(t)) {
      out.push(line);
      continue;
    }
    const core = t.replace(/^\[(?:OTHER|REQUIREMENTS)\]\s*/i, "").trim();
    const prev = out[out.length - 1]?.trim() ?? "";
    if (
      out.length > 0 &&
      core.length > 0 &&
      core.length < MIN_LINE &&
      !/^\[REQUIREMENTS\]\s*$/i.test(prev)
    ) {
      out[out.length - 1] = cleanLine(out[out.length - 1] + " " + line);
    } else {
      out.push(line);
    }
  }
  return out;
}

function prefixBoilerplateIfNeeded(line: string): string {
  const t = line.trim();
  if (!t) return line;
  if (COMPANY_BOILERPLATE_RE.test(t)) {
    return t.startsWith("[OTHER]") ? t : `[OTHER] ${t}`;
  }
  return line;
}

function clampLinesToMax(lines: string[]): string[] {
  return lines.map((L) => (L.length <= MAX_LINE ? L : truncateToMax(L)));
}

const MID_SENTENCE_RESP_RE =
  /\b(?:responsibilities\s+(?:include|are)|you\s+will\s+be\s+responsible\s+for|role\s+includes)\b/i;

/**
 * Mid-sentence fragments that enumerate duties often land in `other`; give the model an explicit heading.
 */
function prependResponsibilityHeadingIfNeeded(line: string): string {
  const t = line.trim();
  if (!t) return line;
  const core = t.replace(/^\[(?:OTHER|REQUIREMENTS)\]\s*/i, "").trim();
  if (!core) return line;
  if (/^responsibilities\s*:/i.test(core)) return line;
  if (!MID_SENTENCE_RESP_RE.test(t)) return line;
  const startsBullet = /^[•·\u2022]/.test(core) || /^\*\s+\S/.test(core);
  if (startsBullet) return line;
  if (/^[A-Z]/.test(core)) return line;
  return `Responsibilities: ${t}`;
}

/**
 * Decode HTML entities, strip minimal tags, drop boilerplate lines, split into classifier-friendly lines.
 */
export function preprocessDescription(description: string): string[] {
  const normalized = normalizeRaw(description);
  if (!normalized) return [];

  const withSections = insertHeadingBreaks(normalized);
  const rawLines = withSections
    .split(/\r?\n+/)
    .map((l) => cleanLine(l))
    .filter(Boolean);

  const candidates: string[] = [];
  for (const raw of rawLines) {
    if (QUALIFICATION_STANDALONE_LINE_RE.test(raw)) {
      candidates.push("[REQUIREMENTS]");
    }

    const pieces = bulletSplit(raw);
    const toExpand = pieces.length ? pieces : [raw];
    for (const piece of toExpand) {
      candidates.push(...expandSegment(piece));
    }
  }

  let merged = rejoinOrphanFragments(candidates);
  merged = rejoinShortTailLines(merged);
  merged = merged.map(prefixBoilerplateIfNeeded);
  merged = merged.filter((L) => {
    if (JUNK_LINE.test(L)) return false;
    const t = L.trim();
    if (/^\[REQUIREMENTS\]\s*$/i.test(t)) return true;
    if (QUALIFICATION_STANDALONE_LINE_RE.test(t)) return true;
    const core = t.replace(/^\[(?:OTHER|REQUIREMENTS)\]\s*/i, "").trim();
    return core.length >= MIN_LINE;
  });

  const seen = new Set<string>();
  const lines: string[] = [];
  for (const L of merged) {
    if (JUNK_LINE.test(L)) continue;
    const k = L.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    lines.push(L);
  }

  const withRespSignal = lines.map(prependResponsibilityHeadingIfNeeded);
  const clamped = clampLinesToMax(withRespSignal);

  if (clamped.length > 0) return clamped;

  const blob = cleanLine(normalized.replace(/\s+/g, " "));
  if (blob.length >= 15) {
    let t = blob.length <= MAX_LINE ? blob : truncateToMax(blob);
    t = prefixBoilerplateIfNeeded(t);
    t = prependResponsibilityHeadingIfNeeded(t);
    if (t.length >= 15) return [t.length <= MAX_LINE ? t : truncateToMax(t)];
  }
  return [];
}
