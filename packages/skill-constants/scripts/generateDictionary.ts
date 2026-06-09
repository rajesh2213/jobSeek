/**
 * Generate dictionaryData.ts from taxonomyEntries.ts — run via `npm run generate`.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SKILL_ALIAS_ENTRIES } from "../src/taxonomyEntries.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "src/dictionaryData.ts");

/** Bare aliases that must never be enrichment scan keys (common English collisions). */
const ENRICHMENT_BARE_BAN = new Set([
  "react",
  "node",
  "next",
  "go",
  "spring",
  "elastic",
  "swift",
  "support",
  "java",
  "rust",
  "ruby",
  "php",
  "vue",
  "sql",
]);

const DISPLAY_LABEL_OVERRIDES: Record<string, string> = {
  aws: "AWS",
  gcp: "GCP",
  nodejs: "Node",
  golang: "Go",
  postgres: "PostgreSQL",
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  mongodb: "MongoDB",
  graphql: "GraphQL",
  nextjs: "Next.js",
  pytorch: "PyTorch",
  tensorflow: "TensorFlow",
  "scikit-learn": "Scikit-learn",
  huggingface: "Hugging Face",
  "github-actions": "GitHub Actions",
  "react-native": "React Native",
  "customer-support": "Customer Support",
  "project-management": "Project Management",
  powerbi: "Power BI",
  bigquery: "BigQuery",
  dynamodb: "DynamoDB",
  elasticsearch: "Elasticsearch",
  fastapi: "FastAPI",
  tailwind: "Tailwind CSS",
  typescript: "TypeScript",
};

function titleCaseCanonical(canonical: string): string {
  if (DISPLAY_LABEL_OVERRIDES[canonical]) return DISPLAY_LABEL_OVERRIDES[canonical]!;
  return canonical
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function isEnrichmentKey(alias: string, mode: string): boolean {
  const a = alias.toLowerCase();
  if (ENRICHMENT_BARE_BAN.has(a)) return false;
  if (a.includes(" ")) return mode === "phrase";
  if (a.includes(".") || a.includes("-")) return true;
  if (mode === "short-allow") return true;
  return a.length >= 5;
}

const tokenMap: Record<string, string> = {};
const phrases: { phrase: string; canonical: string }[] = [];
const canonicalSet = new Set<string>();

const phraseKeys = new Set<string>();
const addPhrase = (phrase: string, canonical: string) => {
  const p = phrase.toLowerCase().replace(/\s+/g, " ").trim();
  if (!p.includes(" ")) return;
  const key = `${p}|${canonical}`;
  if (phraseKeys.has(key)) return;
  phraseKeys.add(key);
  phrases.push({ phrase: p, canonical });
};

for (const entry of SKILL_ALIAS_ENTRIES) {
  const alias = entry.alias.toLowerCase();
  const { canonical } = entry;
  canonicalSet.add(canonical);
  if (alias.includes(" ")) {
    addPhrase(alias, canonical);
  } else {
    tokenMap[alias] = canonical;
    if (alias.includes(".")) {
      addPhrase(alias.replace(/\./g, " "), canonical);
    }
  }
}

phrases.sort((a, b) => b.phrase.length - a.phrase.length);

const enrichmentSeen = new Set<string>();
const enrichment: { key: string; label: string; canonical: string }[] = [];
for (const entry of SKILL_ALIAS_ENTRIES) {
  if (!isEnrichmentKey(entry.alias, entry.mode)) continue;
  const key = entry.alias.toLowerCase();
  const dedupe = `${entry.canonical}|${key}`;
  if (enrichmentSeen.has(dedupe)) continue;
  enrichmentSeen.add(dedupe);
  enrichment.push({
    key,
    label: titleCaseCanonical(entry.canonical),
    canonical: entry.canonical,
  });
}

function buildAliasesByCanonical(): Record<string, string[]> {
  const m = new Map<string, Set<string>>();
  const add = (canonical: string, variant: string) => {
    const v = variant.toLowerCase().trim();
    if (v.length < 2 || v === canonical) return;
    if (!m.has(canonical)) m.set(canonical, new Set());
    m.get(canonical)!.add(v);
  };
  for (const [token, can] of Object.entries(tokenMap)) {
    if (token !== can) add(can, token);
  }
  for (const { phrase, canonical } of phrases) {
    add(canonical, phrase);
  }
  for (const e of enrichment) {
    if (e.key !== e.canonical) add(e.canonical, e.key);
  }
  const out: Record<string, string[]> = {};
  for (const [c, set] of m) {
    out[c] = [...set].sort((a, b) => b.length - a.length);
  }
  return out;
}

const aliasesByCanonical = buildAliasesByCanonical();
const canonicalIds = [...canonicalSet].sort();

function fmtRecord(obj: Record<string, string>): string {
  const lines = Object.entries(obj)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  return `{\n${lines.join("\n")}\n}`;
}

function fmtPhraseArray(arr: { phrase: string; canonical: string }[]): string {
  const lines = arr.map(
    (p) => `  { phrase: ${JSON.stringify(p.phrase)}, canonical: ${JSON.stringify(p.canonical)} },`,
  );
  return `[\n${lines.join("\n")}\n]`;
}

function fmtEnrichment(
  arr: { key: string; label: string; canonical: string }[],
): string {
  const lines = arr.map(
    (e) =>
      `  { key: ${JSON.stringify(e.key)}, label: ${JSON.stringify(e.label)}, canonical: ${JSON.stringify(e.canonical)} },`,
  );
  return `[\n${lines.join("\n")}\n]`;
}

function fmtAliases(obj: Record<string, string[]>): string {
  const lines = Object.entries(obj)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, vals]) => `  ${JSON.stringify(k)}: ${JSON.stringify(vals)},`);
  return `{\n${lines.join("\n")}\n}`;
}

const content = `// AUTO-GENERATED — DO NOT EDIT
// Source: packages/skill-constants/src/taxonomyEntries.ts
// Regenerate: npm run generate -w @jobseek/skill-constants

export const ENRICHMENT_KEYWORDS: readonly {
  key: string;
  label: string;
  canonical: string;
}[] = ${fmtEnrichment(enrichment)} as const;

export const TOKEN_TO_CANONICAL: Readonly<Record<string, string>> = ${fmtRecord(tokenMap)} as const;

export const PHRASE_TO_CANONICAL: readonly { phrase: string; canonical: string }[] = ${fmtPhraseArray(phrases)};

export const CANONICAL_IDS: readonly string[] = ${JSON.stringify(canonicalIds)};

export const CANONICAL_SET: ReadonlySet<string> = new Set(CANONICAL_IDS);

export const ALIASES_BY_CANONICAL: Readonly<Record<string, string[]>> = ${fmtAliases(aliasesByCanonical)};

export function dictionaryFingerprintPayload(): string {
  return JSON.stringify({
    enrichment: ENRICHMENT_KEYWORDS,
    token: TOKEN_TO_CANONICAL,
    phrase: PHRASE_TO_CANONICAL,
  });
}
`;

writeFileSync(outPath, content, "utf8");
console.log(
  `Generated ${outPath}: ${canonicalIds.length} canonicals, ${Object.keys(tokenMap).length} tokens, ${phrases.length} phrases, ${enrichment.length} enrichment keys`,
);
