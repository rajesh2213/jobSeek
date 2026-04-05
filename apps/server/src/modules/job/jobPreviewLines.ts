import he from "he";
import { lineMatchesCompanyBoilerplate } from "../ai/preprocessDescription.js";
import { cleanJobDescription } from "../../utils/cleanJobDescription.js";

export type JobPreviewLinesSource =
  | "responsibility"
  | "requirement"
  | "benefit"
  | "other"
  | "fallback";

export type JobPreviewLinesResult = {
  previewLines: string[];
  previewLinesSource: JobPreviewLinesSource;
};

type ParsedBuckets = {
  responsibility?: unknown;
  requirement?: unknown;
  benefit?: unknown;
  other?: unknown;
};

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === "string");
}

const BRACKET_PREFIX_RE =
  /^\s*\[(?:OTHER|REQUIREMENTS?|RESPONSIBILITIES?|POSITION|BENEFIT|CONTACT|EXPERIENCE)\]\s*/i;

const BOILERPLATE_CONTAINS_RE =
  /Mission of Serving|feel like you're part of/i;

function expandBucketToLines(entries: string[] | undefined): string[] {
  if (!entries?.length) return [];
  const out: string[] = [];
  for (const e of entries) {
    for (const part of String(e).split(/\r?\n+/)) {
      const t = part.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

function stripParsedPrefixes(line: string): string {
  let s = line;
  for (;;) {
    const next = s.replace(BRACKET_PREFIX_RE, "").trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

function truncateLine(s: string, maxChars: number): string {
  const t = s.trim();
  if (t.length <= maxChars) return t;
  const cut = t.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > 48 ? cut.slice(0, lastSpace) : cut.slice(0, maxChars - 1);
  return `${base.trimEnd()}…`;
}

function isSkippablePreviewLine(
  raw: string,
  opts: { bucket: JobPreviewLinesSource; companyName: string },
): boolean {
  const decoded = he.decode(raw);
  const stripped = stripParsedPrefixes(decoded).trim();
  if (stripped.length < 30) return true;

  const lower = stripped.toLowerCase();
  if (lower.startsWith("career category")) return true;
  if (lower.startsWith("job description")) return true;
  if (BOILERPLATE_CONTAINS_RE.test(stripped)) return true;
  if (lineMatchesCompanyBoilerplate(stripped)) return true;

  if (opts.bucket === "other" && opts.companyName.trim().length >= 3) {
    const cn = opts.companyName.trim().toLowerCase();
    if (lower.startsWith(cn)) return true;
  }

  return false;
}

function normalizePreviewLine(raw: string): string {
  const decoded = he.decode(raw);
  const stripped = stripParsedPrefixes(decoded).trim();
  return truncateLine(stripped, 120);
}

function takeFromParsed(
  parsed: ParsedBuckets | null | undefined,
  companyName: string,
): JobPreviewLinesResult | null {
  if (!parsed || typeof parsed !== "object") return null;

  const order: JobPreviewLinesSource[] = [
    "responsibility",
    "requirement",
    "benefit",
    "other",
  ];

  for (const bucket of order) {
    const key = bucket as keyof ParsedBuckets;
    const lines = expandBucketToLines(asStringArray(parsed[key]));
    const picked: string[] = [];
    for (const line of lines) {
      if (isSkippablePreviewLine(line, { bucket, companyName })) continue;
      picked.push(normalizePreviewLine(line));
      if (picked.length >= 2) break;
    }
    if (picked.length > 0) {
      return { previewLines: picked, previewLinesSource: bucket };
    }
  }

  return null;
}

function fallbackFromDescription(
  description: string | null | undefined,
): JobPreviewLinesResult {
  const cleaned = cleanJobDescription(description);
  if (!cleaned?.trim()) {
    return {
      previewLines: ["Details open on the company careers site when you apply."],
      previewLinesSource: "fallback",
    };
  }

  const t = cleaned.trim().replace(/\s+/g, " ");
  const segments = t.includes(". ") ? t.split(/(?<=\.)\s+/) : [t];
  for (const seg of segments) {
    const candidate = seg.trim();
    if (candidate.length < 30) continue;
    if (isSkippablePreviewLine(candidate, { bucket: "fallback", companyName: "" })) continue;
    return {
      previewLines: [truncateLine(candidate, 120)],
      previewLinesSource: "fallback",
    };
  }

  const max = 160;
  const slice =
    t.length <= max
      ? t
      : (() => {
          const s = t.slice(0, max);
          const ls = s.lastIndexOf(" ");
          return ls > 48 ? s.slice(0, ls) : s;
        })();
  return {
    previewLines: [truncateLine(slice.trim(), 120)],
    previewLinesSource: "fallback",
  };
}

export function buildJobPreviewLines(job: {
  parsedDescription: unknown;
  description: string | null;
  company: { name: string };
}): JobPreviewLinesResult {
  const parsed = job.parsedDescription as ParsedBuckets | null | undefined;
  const fromParsed = takeFromParsed(parsed, job.company.name);
  if (fromParsed) return fromParsed;
  return fallbackFromDescription(job.description);
}
