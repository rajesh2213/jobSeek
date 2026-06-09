import { isKnownSkillSlug } from "./taxonomy";

function toSkillSlug(token: string): string {
  return token
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Noise tokens when mining requirement lines for browse links. */
const STOP = new Set(
  [
    "the",
    "a",
    "an",
    "and",
    "or",
    "with",
    "for",
    "to",
    "in",
    "of",
    "on",
    "at",
    "as",
    "by",
    "from",
    "years",
    "year",
    "experience",
    "strong",
    "excellent",
    "good",
    "ability",
    "skills",
    "team",
    "work",
    "working",
    "knowledge",
    "understanding",
    "degree",
    "bachelor",
    "master",
    "phd",
    "plus",
    "preferred",
    "required",
    "must",
    "should",
  ].map((s) => s.toLowerCase()),
);

/**
 * Pull short phrases from requirement bullets for SEO footer "browse by skill" links.
 */
export function tokensFromRequirementLines(lines: string[], max = 14): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const chunks = line.split(/[,;·•]|\s+(?:and|or)\s+/i);
    for (let chunk of chunks) {
      chunk = chunk.replace(/^[\s\-–—•]+|[\s\-–—]+$/g, "").trim();
      if (chunk.length < 3 || chunk.length > 48) continue;
      const words = chunk.split(/\s+/);
      if (words.length > 4) continue;
      const key = chunk.toLowerCase();
      if (STOP.has(key)) continue;
      const first = words[0]?.toLowerCase();
      if (first && STOP.has(first)) continue;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(chunk);
      }
      if (out.length >= max) return out;
    }
  }
  return out;
}

export function mergeBrowseSkillQueries(
  dynamic: string[],
  fallback: string[],
  cap = 12,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...dynamic, ...fallback]) {
    const t = s.trim();
    if (!t) continue;
    const slug = toSkillSlug(t);
    if (!slug || !isKnownSkillSlug(slug)) continue;
    const k = slug.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(slug);
    if (out.length >= cap) break;
  }
  return out;
}
