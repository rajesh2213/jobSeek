import { normalizeKeywordForMatch } from "@jobseek/skill-constants";
import { isKnownSkillSlug } from "../config/taxonomy.js";
import {
  filterSkillsByJobContext,
  normalizeJobAttributes,
} from "./taxonomyNormalizer.js";

function maxMergedSkills(): number {
  const n = Number(process.env.MAX_MERGED_SKILLS ?? "60");
  return Math.max(1, Math.min(75, Number.isFinite(n) ? n : 60));
}

/** Map enrichment display labels / free tokens → canonical skill slugs. */
export function canonicalizeEnrichmentSkillTokens(tokens: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tokens) {
    const slug = normalizeKeywordForMatch(raw.trim()).toLowerCase();
    if (!slug || seen.has(slug)) continue;
    if (!isKnownSkillSlug(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

/** Union taxonomy + enrichment slugs, capped. */
export function mergeTaxonomyAndEnrichmentSkills(
  taxonomySkills: string[],
  enrichmentTokens: string[],
  max: number = maxMergedSkills(),
): string[] {
  const enrichment = canonicalizeEnrichmentSkillTokens(enrichmentTokens);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of taxonomySkills) {
    const t = s.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= max) return out;
  }
  for (const s of enrichment) {
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= max) return out;
  }
  return out;
}

/**
 * Authoritative job skills for persist: taxonomy from title+description, optional enrichment,
 * then occupation + category contradiction filters.
 */
export function deriveJobSkills(input: {
  title: string;
  description?: string | null;
  location?: string | null;
  isRemote: boolean;
  category?: string | null;
  /** When set (e.g. ingest already ran `normalizeJobAttributes`), skip re-scanning description. */
  taxonomySkills?: string[];
  enrichmentTechStack?: string[];
}): string[] {
  let taxonomySkills = input.taxonomySkills;
  let category = input.category?.trim() || undefined;
  if (taxonomySkills === undefined) {
    const attrs = normalizeJobAttributes({
      title: input.title,
      description: input.description ?? undefined,
      location: input.location ?? undefined,
      isRemote: input.isRemote,
    });
    taxonomySkills = attrs.skills;
    category = category ?? attrs.category;
  }
  const merged = mergeTaxonomyAndEnrichmentSkills(
    taxonomySkills,
    input.enrichmentTechStack ?? [],
  );
  return filterSkillsByJobContext(merged, input.title, category);
}
