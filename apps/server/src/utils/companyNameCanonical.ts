/**
 * Stable keys for matching company display names across "Stripe", "Stripe Inc.", etc.
 */

const LEGAL_SUFFIX =
  /\b(inc\.?|incorporated|llc|l\.?l\.?c\.?|ltd\.?|limited|plc|corp\.?|corporation|co\.|company|gmbh|ag|sa|bv|nv|pvt\.?|private|llp|lp)\b/gi;

const PUNCT = /[^a-z0-9\s]/gi;

/**
 * Primary segment before comma; strip legal suffixes; lowercase; collapse spaces.
 */
export function canonicalCompanyNameKey(name: string): string {
  const primary = name.split(",")[0]!.trim();
  let s = primary
    .replace(LEGAL_SUFFIX, " ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  s = s.replace(PUNCT, " ");
  s = s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

/** Alias keys for map lookup (same company, different spellings). */
export function companyNameAliasKeys(name: string): string[] {
  const canon = canonicalCompanyNameKey(name);
  const loose = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  const keys = new Set<string>();
  if (canon) keys.add(canon);
  if (loose) keys.add(loose);
  const first = canon.split(" ").filter((w) => w.length > 2)[0];
  if (first && first.length >= 4) keys.add(first);
  return [...keys];
}

/**
 * Dice coefficient on bigrams (0–1). Good for fuzzy company name vs RemoteOK label.
 */
export function diceSimilarity(a: string, b: string): number {
  const A = canonicalCompanyNameKey(a);
  const B = canonicalCompanyNameKey(b);
  if (!A.length || !B.length) return 0;
  if (A === B) return 1;

  const bigrams = (s: string): string[] => {
    const out: string[] = [];
    const pad = ` ${s} `;
    for (let i = 0; i < pad.length - 1; i += 1) {
      out.push(pad.slice(i, i + 2));
    }
    return out;
  };

  const bgA = bigrams(A);
  const bgB = bigrams(B);
  const counts = new Map<string, number>();
  for (const x of bgB) counts.set(x, (counts.get(x) ?? 0) + 1);
  let inter = 0;
  for (const x of bgA) {
    const c = counts.get(x);
    if (c && c > 0) {
      inter += 1;
      counts.set(x, c - 1);
    }
  }
  return (2 * inter) / (bgA.length + bgB.length);
}

/** Default: require ≥ this for fuzzy name match (reduces false positives). */
export const FUZZY_COMPANY_MATCH_MIN = 0.82;
