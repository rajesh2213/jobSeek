const BLOCKLIST_KEYWORDS = ["stealth", "confidential", "hiring", "anonymous"] as const;
const GENERIC_TOKENS = new Set([
  "company",
  "team",
  "startup",
  "inc",
  "llc",
  "corp",
  "co",
  "ltd",
  "group",
  "solutions",
  "technologies",
]);

const MIN_LEN = 3;
const MAX_LEN = 80;

function stripEdgePunct(w: string): string {
  return w
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}]+$/u, "");
}

function hasVowel(text: string): boolean {
  return /[aeiou]/i.test(text);
}

/**
 * Rejects low-signal names for CSV fallback inserts before createRawCompany().
 */
export function shouldRejectForCsvFallback(
  name: string,
):
  | {
      reject: true;
      reason:
        | "too_short"
        | "too_long"
        | "no_letters"
        | "blocked_keyword"
        | "no_vowels"
        | "generic_token"
        | "junk_pattern";
    }
  | { reject: false } {
  const trimmed = name.trim();
  if (trimmed.length < MIN_LEN) {
    return { reject: true, reason: "too_short" };
  }
  if (trimmed.length > MAX_LEN) {
    return { reject: true, reason: "too_long" };
  }
  if (!/[\p{L}]/u.test(trimmed)) {
    return { reject: true, reason: "no_letters" };
  }

  const lower = trimmed.toLowerCase();
  if (BLOCKLIST_KEYWORDS.some((w) => lower.includes(w))) {
    return { reject: true, reason: "blocked_keyword" };
  }

  const words = trimmed
    .split(/\s+/)
    .map((w) => stripEdgePunct(w.toLowerCase()))
    .filter(Boolean);

  if (!hasVowel(words.join(" "))) {
    return { reject: true, reason: "no_vowels" };
  }

  const genericCount = words.filter((w) => GENERIC_TOKENS.has(w)).length;
  const startsWithCompany = words[0] === "company";
  if (
    genericCount >= 2 ||
    (words.length > 0 && genericCount === words.length) ||
    (startsWithCompany && words.length <= 3) ||
    (genericCount >= 1 && words.length <= 2)
  ) {
    return { reject: true, reason: "generic_token" };
  }

  if (/^(test|demo|sample|placeholder|unknown|n\/a|null|none)[\W_]*\d*$/i.test(lower)) {
    return { reject: true, reason: "junk_pattern" };
  }

  return { reject: false };
}
