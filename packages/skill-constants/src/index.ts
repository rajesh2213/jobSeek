export {
  ENRICHMENT_KEYWORDS,
  TOKEN_TO_CANONICAL,
  PHRASE_TO_CANONICAL,
  CANONICAL_IDS,
  CANONICAL_SET,
  ALIASES_BY_CANONICAL,
  dictionaryFingerprintPayload,
} from "./dictionaryData.js";
export { djb2Hash32 } from "./hash.js";
export { keywordMatches, extractEnrichmentTechStack } from "./enrichment.js";

import { djb2Hash32 } from "./hash.js";
import {
  ENRICHMENT_KEYWORDS,
  dictionaryFingerprintPayload,
  PHRASE_TO_CANONICAL,
  TOKEN_TO_CANONICAL,
  CANONICAL_SET,
  CANONICAL_IDS,
} from "./dictionaryData.js";

export const DICTIONARY_VERSION: string = `djb2-${djb2Hash32(dictionaryFingerprintPayload())}`;

const displayByCanonical: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const e of ENRICHMENT_KEYWORDS) m.set(e.canonical, e.label);
  return m;
})();

export function getSkillDisplayLabel(canonical: string): string {
  return displayByCanonical.get(canonical) ?? canonical;
}

/**
 * For resume / JD lines: lowercase, strip punctuation to spaces, collapse whitespace.
 * Converts `node.js` style tokens into `node js` for phrase resolution.
 */
export function normalizeLineForSkillScan(line: string): string {
  return line
    .toLowerCase()
    .replace(/[.,;:!?'"()[\]{}]+/g, " ")
    .replace(/[^a-z0-9#+.\s-]/g, " ")
    .replace(/[.]+/g, " ")
    .replace(/[-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanToken(t: string): string {
  return t
    .toLowerCase()
    .replace(/^[.,;:!?'"()[\]{}]+/g, "")
    .replace(/[.,;:!?'"()[\]{}]+$/g, "")
    .trim();
}

/**
 * Map a single token to a known canonical id, or `null` if not in the dictionary.
 */
export function getCanonicalFromToken(rawToken: string): string | null {
  const k = cleanToken(rawToken);
  if (k.length < 2) return null;
  if (CANONICAL_SET.has(k)) return k;
  const v = TOKEN_TO_CANONICAL[k];
  if (v && CANONICAL_SET.has(v)) return v;
  return null;
}

export interface RequirementLineMatch {
  canonical: string;
  matchedBy: "phrase" | "token";
}

function collectNonOverlappingPhraseMatches(normalized: string): { start: number; end: number; canonical: string }[] {
  const n = normalized;
  const matches: { start: number; end: number; canonical: string }[] = [];
  let i = 0;
  while (i < n.length) {
    if (n[i] === " ") {
      i++;
      continue;
    }
    if (i > 0 && n[i - 1] !== " ") {
      i++;
      continue;
    }
    let hit: { end: number; canonical: string } | null = null;
    for (const { phrase, canonical } of PHRASE_TO_CANONICAL) {
      if (n.slice(i, i + phrase.length) === phrase) {
        const end = i + phrase.length;
        if (end === n.length || n[end] === " ") {
          hit = { end, canonical };
          break;
        }
      }
    }
    if (hit) {
      matches.push({ start: i, end: hit.end, canonical: hit.canonical });
      i = hit.end;
    } else {
      i++;
    }
  }
  return matches;
}

/**
 * 1) normalize line 2) match multi-word phrases (longest listed first) 3) tokenize remaining spans for single-token dictionary hits. Deduped by canonical, phrase before token in output order.
 */
export function getCanonicalsFromRequirementLine(line: string): RequirementLineMatch[] {
  const normalized = normalizeLineForSkillScan(line);
  if (!normalized) return [];

  const phraseHits = collectNonOverlappingPhraseMatches(normalized);
  const chars = [...normalized];
  for (const h of phraseHits) {
    for (let j = h.start; j < h.end; j++) chars[j] = " ";
  }
  const masked = chars.join("");

  const out: RequirementLineMatch[] = [];
  const seen = new Set<string>();

  for (const h of phraseHits) {
    if (CANONICAL_SET.has(h.canonical) && !seen.has(h.canonical)) {
      seen.add(h.canonical);
      out.push({ canonical: h.canonical, matchedBy: "phrase" });
    }
  }

  const words = masked.split(/\s+/).filter(Boolean);
  for (const w of words) {
    const c = getCanonicalFromToken(w);
    if (c && !seen.has(c)) {
      seen.add(c);
      out.push({ canonical: c, matchedBy: "token" });
    }
  }

  return out;
}

/**
 * Shorthand for taxonomy entries that are full-line or single-token.
 */
export function getCanonicalsFromTextLine(text: string): RequirementLineMatch[] {
  return getCanonicalsFromRequirementLine(text);
}

/**
 * Best-effort alias → canonical for a single string (taxonomy, free text). Falls back
 * to the stripped lowercase string for unknowns (legacy heuristics may still use it).
 */
export function normalizeKeywordForMatch(s: string): string {
  const k0 = s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,;:]+$/g, "");
  if (k0.length < 2) return k0;
  if (CANONICAL_SET.has(k0)) return k0;
  const lineHit = getCanonicalsFromTextLine(s);
  if (lineHit.length > 0) return lineHit[0]!.canonical;
  return TOKEN_TO_CANONICAL[k0] ?? k0;
}

export function listCanonicalIds(): string[] {
  return [...CANONICAL_IDS];
}