import { ENRICHMENT_KEYWORDS } from "./dictionaryData.ts";

export function keywordMatches(text: string, kw: string): boolean {
  const k = kw.toLowerCase();
  if (k === "c#") return text.toLowerCase().includes("c#");
  if (k === ".net") {
    return /(^|[^a-z0-9])\.net(?![a-z0-9])/i.test(text);
  }
  const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i").test(text);
}

/**
 * Display labels, deduped by label (legacy enrichment.service behavior), ordered by ENRICHMENT_KEYWORDS.
 */
export function extractEnrichmentTechStack(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of ENRICHMENT_KEYWORDS) {
    if (!keywordMatches(text, e.key)) continue;
    const key = e.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e.label);
  }
  return out;
}
