import { sanitizeHtml } from "../modules/ats/ats.interface.js";

export type JobDescriptionHtmlSource = "jsonld" | "meta" | "main" | "body" | "none";

export interface ExtractJobDescriptionOptions {
  /** When true, only accept JobPosting JSON-LD description (no meta/main/body fallback). */
  careersPageStrict?: boolean;
}

export interface JsonLdJobPostingFlags {
  hasJobPosting: boolean;
  title?: string;
  locationLine?: string;
}

function stripTags(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function extractMainlikeInnerText(html: string): string {
  const chunkRe = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  let best = "";
  while ((m = chunkRe.exec(html)) !== null) {
    const inner = m[2] ?? "";
    const plain = stripTags(inner);
    if (plain.length > best.length) best = plain;
  }
  return best;
}

function extractRoleMainInnerText(html: string): string {
  const chunkRe = /<[^>]*\brole\s*=\s*["']main["'][^>]*>([\s\S]*?)<\/[a-z0-9]+>/gi;
  let m: RegExpExecArray | null;
  let best = "";
  while ((m = chunkRe.exec(html)) !== null) {
    const plain = stripTags(m[1] ?? "");
    if (plain.length > best.length) best = plain;
  }
  return best;
}

function extractMetaDescription(html: string): string {
  const m = html.match(
    /<meta\s+[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["']/i,
  );
  if (m?.[1]) return decodeBasicEntities(m[1].trim());
  const m2 = html.match(
    /<meta\s+[^>]*content\s*=\s*["']([^"']*)["'][^>]*name\s*=\s*["']description["']/i,
  );
  return m2?.[1] ? decodeBasicEntities(m2[1].trim()) : "";
}

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function isJobPostingNode(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const t = (node as { "@type"?: unknown })["@type"];
  const types = Array.isArray(t) ? t : [t];
  return types.some((x) =>
    String(x ?? "")
      .toLowerCase()
      .includes("jobposting"),
  );
}

function descriptionFromJsonLdNode(node: Record<string, unknown>): string {
  const d = node.description;
  if (typeof d === "string") return d;
  if (d && typeof d === "object" && "value" in d && typeof (d as { value: unknown }).value === "string") {
    return (d as { value: string }).value;
  }
  return "";
}

function walkJsonLdRoots(html: string, visit: (node: Record<string, unknown>) => void): void {
  const scriptRe = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    const raw = m[1]?.trim();
    if (!raw) continue;
    try {
      const data = JSON.parse(raw) as unknown;
      const nodes = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        visit(node as Record<string, unknown>);
        const g = (node as Record<string, unknown>)["@graph"];
        if (Array.isArray(g)) {
          for (const sub of g) {
            if (sub && typeof sub === "object") {
              visit(sub as Record<string, unknown>);
            }
          }
        }
      }
    } catch {
      /* invalid JSON-LD */
    }
  }
}

function extractJsonLdJobPostingDescription(html: string): string {
  let found = "";
  walkJsonLdRoots(html, (node) => {
    if (!isJobPostingNode(node) || found) return;
    const text = descriptionFromJsonLdNode(node);
    if (text) found = text;
  });
  return found;
}

function titleFromJsonLdNode(node: Record<string, unknown>): string | undefined {
  const t = node.title;
  return typeof t === "string" && t.trim() ? t.trim() : undefined;
}

function jobLocationToLine(raw: unknown): string | undefined {
  if (typeof raw === "string") {
    const s = raw.trim();
    return s || undefined;
  }
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const name = o.name;
  if (typeof name === "string" && name.trim()) return name.trim();

  const addr = o.address;
  if (typeof addr === "string" && addr.trim()) return addr.trim();
  if (addr && typeof addr === "object") {
    const a = addr as Record<string, unknown>;
    const parts = [a.addressLocality, a.addressRegion, a.addressCountry]
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean);
    if (parts.length) {
      return parts.join(", ").replace(/\s+/g, " ").replace(/^\s*,\s*/g, "").trim();
    }
  }
  return undefined;
}

function locationLineFromJobPostingNode(node: Record<string, unknown>): string | undefined {
  for (const key of ["jobLocation", "employmentLocation"] as const) {
    const jl = node[key];
    if (Array.isArray(jl)) {
      for (const item of jl) {
        const line = jobLocationToLine(item);
        if (line) return line;
      }
    } else {
      const line = jobLocationToLine(jl);
      if (line) return line;
    }
  }
  return undefined;
}

/**
 * Scan all JSON-LD blocks for schema.org JobPosting (including @graph).
 */
export function extractJsonLdJobPostingFlags(html: string): JsonLdJobPostingFlags {
  let hasJobPosting = false;
  let title: string | undefined;
  let locationLine: string | undefined;

  walkJsonLdRoots(html, (node) => {
    if (!isJobPostingNode(node)) return;
    hasJobPosting = true;
    if (!title) {
      const nt = titleFromJsonLdNode(node);
      if (nt) title = nt;
    }
    if (!locationLine) {
      const line = locationLineFromJobPostingNode(node as Record<string, unknown>);
      if (line) locationLine = line;
    }
  });

  return { hasJobPosting, title, locationLine };
}

function extractOgTitle(html: string): string | undefined {
  const m = html.match(
    /<meta\s+[^>]*property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']*)["']/i,
  );
  if (m?.[1]) return decodeBasicEntities(m[1].trim());
  const m2 = html.match(
    /<meta\s+[^>]*content\s*=\s*["']([^"']*)["'][^>]*property\s*=\s*["']og:title["']/i,
  );
  return m2?.[1] ? decodeBasicEntities(m2[1].trim()) : undefined;
}

function extractDocumentTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m?.[1]) return undefined;
  return decodeBasicEntities(stripTags(m[1]).trim());
}

const TITLE_SUFFIX_RES = [
  /\s*[\|\u2013\u2014-]\s*[^|]+$/i,
  /\s*-\s*(careers|jobs|home|company).*$/i,
];

function cleanHtmlDerivedTitle(raw: string): string {
  let s = raw.trim();
  for (const re of TITLE_SUFFIX_RES) {
    s = s.replace(re, "").trim();
  }
  return s;
}

const LOCATION_HEAD_CHARS = 12_000;
const MAIN_TOP_SLICE = 2000;
const DOM_LOCATION_MAX_TAGS = 15;
const DOM_INNER_SNIPPET = 800;

/** Role/title tokens — penalize lines that look like job titles, not places. */
const JOB_TITLE_WORD_RE =
  /\b(engineer|analyst|manager|director|scientist|developer|designer|lead|architect|specialist|representative|support|sales|product|staff|intern|consultant|coordinator|recruiter|executive|officer)\b/i;

/** City, Region (ASCII or Unicode letters). */
const TIGHT_CITY_REGION_RE =
  /^\p{L}[\p{L}\s&.'-]{0,60},\s*\p{L}[\p{L}\s&.'-]{0,60}$/u;

/** Second segment values that look like UI/version tokens, not geography. */
const NON_PLACE_SECOND_SEGMENT =
  /^(version|line|remote|hybrid|onsite|office|building|resources|apply|search)$/i;

/** Trailing token after comma that usually continues a sentence, not a region. */
const JUNK_TAIL_AFTER_COMMA = new Set(["more", "details", "follow", "here", "below", "the"]);

/** True if string has ". " mid-line (sentence break), excluding St./Mt./Ft. prefixes. */
function looksLikeMidSentencePeriod(s: string): boolean {
  const t = s.trim();
  if (/^(st|mt|ft)\.\s/i.test(t)) return false;
  return /\.\s/.test(t);
}

function matchesTightCityRegion(text: string): boolean {
  const t = normalizeWs(text);
  if (t.length > 100 || t.length < 5) return false;
  const segments = t.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);

  if (segments.length === 2) {
    if (!TIGHT_CITY_REGION_RE.test(t)) return false;
    const left = segments[0]!;
    const right = segments[1]!;
    if (left.length < 2 || right.length < 2) return false;
    if (NON_PLACE_SECOND_SEGMENT.test(right)) return false;
    const leftWords = left.split(/\s+/).filter(Boolean).length;
    const rightWords = right.split(/\s+/).filter(Boolean).length;
    if (leftWords > 4 || rightWords > 4) return false;
    if (looksLikeMidSentencePeriod(left)) return false;
    const lastRight = right.trim().split(/\s+/).pop() ?? "";
    if (JUNK_TAIL_AFTER_COMMA.has(lastRight.toLowerCase())) return false;

    return true;
  }

  if (segments.length === 3) {
    const a = segments[0]!;
    const b = segments[1]!;
    const c = segments[2]!;
    if (a.length < 2 || b.length < 2 || c.length < 2) return false;
    if (NON_PLACE_SECOND_SEGMENT.test(c)) return false;
    if (NON_PLACE_SECOND_SEGMENT.test(b)) return false;
    return true;
  }

  return false;
}

function extractOgSiteName(html: string): string | undefined {
  const m = html.match(
    /<meta\s+[^>]*property\s*=\s*["']og:site_name["'][^>]*content\s*=\s*["']([^"']*)["']/i,
  );
  if (m?.[1]) return decodeBasicEntities(m[1].trim());
  const m2 = html.match(
    /<meta\s+[^>]*content\s*=\s*["']([^"']*)["'][^>]*property\s*=\s*["']og:site_name["']/i,
  );
  return m2?.[1] ? decodeBasicEntities(m2[1].trim()) : undefined;
}

function extractApplicationName(html: string): string | undefined {
  const m = html.match(
    /<meta\s+[^>]*name\s*=\s*["']application-name["'][^>]*content\s*=\s*["']([^"']*)["']/i,
  );
  if (m?.[1]) return decodeBasicEntities(m[1].trim());
  const m2 = html.match(
    /<meta\s+[^>]*content\s*=\s*["']([^"']*)["'][^>]*name\s*=\s*["']application-name["']/i,
  );
  return m2?.[1] ? decodeBasicEntities(m2[1].trim()) : undefined;
}

function extractGenericSiteLabel(html: string): string | null {
  const og = extractOgSiteName(html)?.trim();
  if (og) return og;
  const app = extractApplicationName(html)?.trim();
  if (app) return app;
  const ogTitle = extractOgTitle(html);
  if (ogTitle) {
    const seg = ogTitle.split(/[\|\u2013\u2014-]/)[0]?.trim();
    if (seg && seg.length >= 2 && seg.length < 60) return seg;
  }
  return null;
}

export type LocationCandidate = { text: string; source: string };

function candidateDedupeKey(text: string): string {
  return normalizeWs(text).toLowerCase();
}

/**
 * Collect generic location signals: JSON-LD line, DOM attrs containing "location", main intro text, regex.
 */
export function extractLocationCandidates(
  html: string,
  jp?: JsonLdJobPostingFlags,
): LocationCandidate[] {
  const out: LocationCandidate[] = [];
  const seen = new Set<string>();

  const push = (text: string, source: string): void => {
    const t = normalizeWs(text);
    if (t.length < 3) return;
    const k = candidateDedupeKey(t);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ text: t, source });
  };

  if (jp?.locationLine?.trim()) {
    push(jp.locationLine.trim(), "jsonld");
  }

  const domAttrRe =
    /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*(?:\bclass\s*=\s*["'][^"']*[Ll]ocation[^"']*["']|\bid\s*=\s*["'][^"']*[Ll]ocation[^"']*["']|\bdata-testid\s*=\s*["'][^"']*[Ll]ocation[^"']*["'])[^>]*>/g;
  let domN = 0;
  let dm: RegExpExecArray | null;
  while ((dm = domAttrRe.exec(html)) !== null && domN < DOM_LOCATION_MAX_TAGS) {
    domN += 1;
    const start = dm.index + dm[0].length;
    let chunk = html.slice(start, start + DOM_INNER_SNIPPET);
    const closeIdx = chunk.search(/<\/[a-zA-Z][a-zA-Z0-9]*\s*>/);
    if (closeIdx !== -1) chunk = chunk.slice(0, closeIdx);
    let text = normalizeWs(stripTags(chunk));
    const locSub = text.match(
      /\b(\p{L}[\p{L}\s&.'-]{0,60},\s*\p{L}[\p{L}\s&.'-]{0,60}(?:,\s*\p{L}[\p{L}\s&.'-]{0,60})?)\b/u,
    );
    if (locSub?.[1]) text = normalizeWs(locSub[1]);
    if (text.length >= 3) {
      for (const line of text.split(/[;\n\r]+/).map((s) => normalizeWs(s)).filter(Boolean)) {
        if (line.length <= 200) push(line, "dom_attr_location");
      }
    }
  }

  const mainA = extractMainlikeInnerText(html);
  const mainB = extractRoleMainInnerText(html);
  const mainPick = mainA.length >= mainB.length ? mainA : mainB;
  const top = normalizeWs(mainPick.slice(0, MAIN_TOP_SLICE));
  if (top.length >= 8) {
    const lineParts = top.split(/\n+/).map((l) => normalizeWs(l)).filter(Boolean);
    for (const line of lineParts) {
      if (
        line.length >= 8 &&
        line.length <= 100 &&
        line.includes(",") &&
        !/^https?:\/\//i.test(line)
      ) {
        push(line, "main_top");
      }
    }
    for (const sentence of top.split(/(?:[.!?]\s+|\n+)/)) {
      const s = normalizeWs(sentence);
      if (
        s.length >= 8 &&
        s.length <= 100 &&
        s.includes(",") &&
        !/^https?:\/\//i.test(s)
      ) {
        push(s, "main_top");
      }
    }
  }

  const head = stripTags(html.slice(0, LOCATION_HEAD_CHARS));
  const tightRe =
    /\b(\p{L}[\p{L}\s&.'-]{0,60},\s*\p{L}[\p{L}\s&.'-]{0,60})\b/gu;
  let rm: RegExpExecArray | null;
  while ((rm = tightRe.exec(head)) !== null) {
    push(rm[1]!, "regex_city_region");
  }
  const looseRe = /(\p{L}[\p{L}\s]{1,50},\s*\p{L}[\p{L}\s]{1,50})/gu;
  while ((rm = looseRe.exec(head)) !== null) {
    const s = normalizeWs(rm[1]!);
    if (s.length <= 80) push(s, "regex_city_region_loose");
  }

  return out;
}

export function scoreLocationCandidate(text: string, source: string, siteLabel: string | null): number {
  let score = 0;
  if (matchesTightCityRegion(text)) score += 40;
  if (source === "jsonld") score += 30;
  if (source === "dom_attr_location") score += 25;
  if (source === "main_top") score += 15;

  const words = text.trim().split(/\s+/).filter(Boolean);
  const wc = words.length;
  if (wc >= 2 && wc <= 5) score += 10;

  if (JOB_TITLE_WORD_RE.test(text)) score -= 40;
  if (text.length > 100) score -= 20;
  if (siteLabel && siteLabel.length >= 2 && text.toLowerCase().includes(siteLabel.toLowerCase())) {
    score -= 20;
  }
  return score;
}

export function selectBestLocationCandidate(
  candidates: LocationCandidate[],
  siteLabel: string | null,
): { text: string; score: number } | null {
  if (candidates.length === 0) return null;
  let best: { text: string; score: number } | null = null;
  for (const c of candidates) {
    const t = normalizeWs(c.text);
    if (t.length < 3) continue;
    const s = scoreLocationCandidate(t, c.source, siteLabel);
    if (!best || s > best.score) best = { text: t, score: s };
  }
  if (best && best.score >= 40) return best;
  return null;
}

function legacyVisibleLocationFromHtml(html: string): string | null {
  const head = stripTags(html.slice(0, LOCATION_HEAD_CHARS));
  const bullet = head.match(
    /\b([A-Za-z0-9][A-Za-z0-9\s&,'.-]{1,48})\s*[•·|]\s*([A-Za-z0-9][A-Za-z0-9\s,.-]{2,80})\b/,
  );
  if (bullet) {
    const right = bullet[2]!.trim();
    if (right.length >= 3 && !/^(find|discover|resources|sign)/i.test(right)) {
      return `${bullet[1]!.trim()} • ${right}`;
    }
  }

  const cityStateOneWord = head.match(
    /\b([A-Za-z][a-z]+(?:\s+[A-Za-z][a-z]+)?,\s*[A-Za-z][a-z]+)\b/,
  );
  if (cityStateOneWord && cityStateOneWord[1]!.length < 80) {
    return cityStateOneWord[1]!.trim();
  }

  const cityCityTwoWords = head.match(
    /\b([A-Za-z][a-z]+(?:\s+[A-Za-z][a-z]+)?,\s*[A-Za-z][a-z]+(?:\s+[A-Za-z][a-z]+)?)\b/,
  );
  if (cityCityTwoWords && cityCityTwoWords[1]!.length < 80) {
    return cityCityTwoWords[1]!.trim();
  }

  return null;
}

/**
 * Prefer JSON-LD JobPosting title, then og:title, then document title.
 * Pass `jp` from a single `extractJsonLdJobPostingFlags(html)` call to avoid re-parsing JSON-LD.
 */
export function extractJobTitleFromHtml(html: string, jp?: JsonLdJobPostingFlags): string | null {
  const flags = jp ?? extractJsonLdJobPostingFlags(html);
  if (flags.title && flags.title.length >= 3) return cleanHtmlDerivedTitle(flags.title);

  const og = extractOgTitle(html);
  if (og && og.length >= 3) return cleanHtmlDerivedTitle(og);

  const doc = extractDocumentTitle(html);
  if (doc && doc.length >= 3) return cleanHtmlDerivedTitle(doc);

  return null;
}

/**
 * JSON-LD jobLocation first; then scored generic candidates (DOM / main / regex); then legacy bullet + City, Region.
 */
export function extractJobLocationFromHtml(html: string, jp?: JsonLdJobPostingFlags): string | null {
  const flags = jp ?? extractJsonLdJobPostingFlags(html);
  if (flags.locationLine?.trim()) return flags.locationLine.trim();

  const siteLabel = extractGenericSiteLabel(html);
  const candidates = extractLocationCandidates(html, flags);
  const picked = selectBestLocationCandidate(candidates, siteLabel);
  if (picked) return picked.text;

  return legacyVisibleLocationFromHtml(html);
}

const MIN_MEANINGFUL_LEN = 120;

/**
 * Extract plain-text job description from arbitrary job-detail HTML.
 * Priority: JSON-LD JobPosting → meta description → main/article → stripped body.
 * With `careersPageStrict`, only JSON-LD text counts (must meet min length).
 */
export function extractJobDescriptionFromHtml(
  html: string,
  options?: ExtractJobDescriptionOptions,
): {
  text: string;
  source: JobDescriptionHtmlSource;
} {
  const jsonldRaw = extractJsonLdJobPostingDescription(html);
  const jsonldPlain = normalizeWs(sanitizeHtml(jsonldRaw) ?? stripTags(jsonldRaw));

  if (options?.careersPageStrict) {
    if (jsonldPlain.length >= MIN_MEANINGFUL_LEN) {
      return { text: jsonldPlain, source: "jsonld" };
    }
    return { text: "", source: "none" };
  }

  const metaRaw = extractMetaDescription(html);

  const mainRaw = extractMainlikeInnerText(html);
  const mainPlain = normalizeWs(mainRaw);

  const bodyPlain = normalizeWs(stripTags(html));

  const candidates: Array<{ text: string; source: JobDescriptionHtmlSource }> = [
    { text: jsonldPlain, source: "jsonld" },
    { text: metaRaw, source: "meta" },
    { text: mainPlain, source: "main" },
    { text: bodyPlain, source: "body" },
  ];

  for (const c of candidates) {
    if (c.text.length >= MIN_MEANINGFUL_LEN) {
      return { text: c.text, source: c.source };
    }
  }

  const best = candidates.reduce((a, b) => (b.text.length > a.text.length ? b : a));
  if (best.text.length > 0) {
    return { text: best.text, source: best.source };
  }
  return { text: "", source: "none" };
}

/** JSON-LD JobPosting fields only (no meta/main/body). Used by careers self-heal `jsonld_only`. */
export interface JsonLdJobPostingStrictExtract {
  hasJobPosting: boolean;
  title: string | null;
  description: string | null;
  /** Resolved jobLocation line from JobPosting (avoid naming this `location` — clashes with DOM `Location` in TS). */
  locationLine: string | null;
}

/**
 * Strict JobPosting parse: title, plain-text description, location line from schema.org only.
 */
export function extractJsonLdJobPostingStrict(html: string): JsonLdJobPostingStrictExtract {
  let hasJobPosting = false;
  const acc = {
    title: null as string | null,
    description: null as string | null,
    locationLine: null as string | null,
  };

  walkJsonLdRoots(html, (node) => {
    if (!isJobPostingNode(node)) return;
    hasJobPosting = true;
    if (!acc.title) {
      const t = titleFromJsonLdNode(node);
      if (t) acc.title = t.trim();
    }
    if (!acc.description) {
      const raw = descriptionFromJsonLdNode(node);
      if (raw) {
        const plain = normalizeWs(sanitizeHtml(raw) ?? stripTags(raw));
        if (plain) acc.description = plain;
      }
    }
    if (!acc.locationLine) {
      const line = locationLineFromJobPostingNode(node as Record<string, unknown>);
      if (line) acc.locationLine = line;
    }
  });

  return {
    hasJobPosting,
    title: acc.title,
    description: acc.description,
    locationLine: acc.locationLine != null ? acc.locationLine.trim() : null,
  };
}

/**
 * Title from og:title and document `<title>` only (no JSON-LD). For self-heal `relaxed_title`.
 */
export function extractRelaxedTitleFromHtml(html: string): string | null {
  const og = extractOgTitle(html);
  if (og && og.length >= 3) return cleanHtmlDerivedTitle(og);

  const doc = extractDocumentTitle(html);
  if (doc && doc.length >= 3) return cleanHtmlDerivedTitle(doc);

  return null;
}

const MAIN_CONTENT_NOISE_LINE =
  /^(cookie|privacy policy|©|all rights reserved|sign up|subscribe|navigation|menu|footer)$/i;

/**
 * Longest main-like plain text (main, role=main, article); drops obvious chrome lines.
 */
export function extractDescriptionFromMainContent(html: string): string {
  const chunks: string[] = [
    extractMainlikeInnerText(html),
    extractRoleMainInnerText(html),
  ];
  let best = "";
  for (const raw of chunks) {
    const lines = raw
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !MAIN_CONTENT_NOISE_LINE.test(line));
    const joined = normalizeWs(lines.join(" "));
    if (joined.length > best.length) best = joined;
  }
  const plain = normalizeWs(sanitizeHtml(best) ?? best);
  return plain;
}

/**
 * Location heuristics without JSON-LD (bullet line, City, Region). For self-heal `location_fallback`.
 */
export function extractLocationFallbackFromHtml(html: string): string | null {
  return legacyVisibleLocationFromHtml(html);
}

// ---------------------------------------------------------------------------
// JSON-LD Salary Extraction
// ---------------------------------------------------------------------------

export interface JsonLdSalary {
  minValue: number;
  maxValue: number | null;
  currency: string;
}

const ANNUAL_MIN = 10_000;
const ANNUAL_MAX = 2_000_000;
const HOURLY_MIN = 7;
const HOURLY_MAX = 500;
const MONTHLY_MIN = 1_000;
const MONTHLY_MAX = 90_000;
const HOURS_PER_YEAR = 2080;
const MONTHS_PER_YEAR = 12;

function coerceNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[,$\s]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function coerceString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/**
 * Resolve min/max/currency/unit from the wildly inconsistent shapes ATS
 * platforms use for `baseSalary` / `estimatedSalary` in JSON-LD.
 */
function resolveSalaryNode(
  salary: unknown,
): { min?: number; max?: number; currency?: string; unit?: string } | null {
  if (!salary || typeof salary !== "object") return null;
  const s = salary as Record<string, unknown>;

  let currency = coerceString(s.currency);
  let unit: string | undefined;
  let min: number | undefined;
  let max: number | undefined;

  const value = s.value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    min = coerceNumber(v.minValue);
    max = coerceNumber(v.maxValue);
    unit = coerceString(v.unitText);
    if (min == null && max == null) {
      const single = coerceNumber(v.value);
      if (single != null) {
        min = single;
      }
    }
  } else if (Array.isArray(value) && value.length > 0) {
    const first = value[0];
    if (first && typeof first === "object") {
      return resolveSalaryNode({ ...s, value: first });
    }
    const n = coerceNumber(first);
    if (n != null) min = n;
  } else if (typeof value === "number" || typeof value === "string") {
    min = coerceNumber(value);
  }

  if (min == null && max == null) {
    min = coerceNumber(s.minValue);
    max = coerceNumber(s.maxValue);
  }

  if (!unit) unit = coerceString(s.unitText);
  if (!currency) currency = coerceString((s.value as Record<string, unknown>)?.currency);

  if (min == null && max == null) return null;

  return { min, max, currency, unit };
}

function normalizeToAnnual(
  raw: number,
  unit: string | undefined,
): number | null {
  const u = (unit ?? "YEAR").toUpperCase();
  let annual: number;
  if (u === "YEAR" || u === "ANNUALLY") {
    annual = raw;
  } else if (u === "HOUR" || u === "HOURLY") {
    if (raw < HOURLY_MIN || raw >= HOURLY_MAX) return null;
    annual = raw * HOURS_PER_YEAR;
  } else if (u === "MONTH" || u === "MONTHLY") {
    if (raw < MONTHLY_MIN || raw >= MONTHLY_MAX) return null;
    annual = raw * MONTHS_PER_YEAR;
  } else if (u === "WEEK" || u === "WEEKLY") {
    annual = raw * 52;
  } else {
    return null;
  }
  return annual >= ANNUAL_MIN && annual <= ANNUAL_MAX ? Math.round(annual) : null;
}

/**
 * Extract structured salary from JSON-LD `baseSalary` (or `estimatedSalary`)
 * on a Schema.org `JobPosting` node. Returns `null` aggressively on any
 * uncertainty — this is best-effort enrichment, not authoritative.
 *
 * Only returns USD salaries. Normalizes hourly/monthly/weekly to annual.
 */
export function extractSalaryFromJobPostingJsonLd(html: string): JsonLdSalary | null {
  let result: JsonLdSalary | null = null;

  walkJsonLdRoots(html, (node) => {
    if (result) return;
    if (!isJobPostingNode(node)) return;

    const salaryRaw = node.baseSalary ?? node.estimatedSalary;
    if (!salaryRaw) return;

    const items = Array.isArray(salaryRaw) ? salaryRaw : [salaryRaw];
    for (const item of items) {
      const resolved = resolveSalaryNode(item);
      if (!resolved) continue;

      const currency = (resolved.currency ?? "").toUpperCase();
      if (currency !== "USD") continue;

      const unit = resolved.unit;
      let minAnnual = resolved.min != null ? normalizeToAnnual(resolved.min, unit) : null;
      let maxAnnual = resolved.max != null ? normalizeToAnnual(resolved.max, unit) : null;

      if (minAnnual == null && maxAnnual == null) continue;

      if (minAnnual != null && maxAnnual != null) {
        if (minAnnual > maxAnnual) {
          [minAnnual, maxAnnual] = [maxAnnual, minAnnual];
        }
        if (minAnnual === maxAnnual) {
          maxAnnual = null;
        }
      }

      if (minAnnual == null && maxAnnual != null) {
        minAnnual = maxAnnual;
        maxAnnual = null;
      }

      if (minAnnual == null) continue;

      result = { minValue: minAnnual, maxValue: maxAnnual, currency: "USD" };
      return;
    }
  });

  return result;
}
