/**
 * Audit canonical normalization across unified ontology.
 * Run: npx tsx scripts/audit/canonicalNormalizationReport.mjs
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const { register } = await import("tsx/esm/api");
register();

const { SKILL_ALIAS_ENTRIES, KNOWN_SKILL_SLUGS } = await import(
  join(root, "packages/skill-constants/src/taxonomy.ts")
);
const { listCanonicalIds, TOKEN_TO_CANONICAL } = await import(
  join(root, "packages/skill-constants/src/index.ts")
);

const byCanonical = new Map();
for (const entry of SKILL_ALIAS_ENTRIES) {
  if (!byCanonical.has(entry.canonical)) {
    byCanonical.set(entry.canonical, { canonical: entry.canonical, aliases: [] });
  }
  byCanonical.get(entry.canonical).aliases.push(entry.alias);
}

const canonicals = [...byCanonical.values()].map((c) => ({
  ...c,
  aliases: [...new Set(c.aliases)].sort(),
}));

const tokenTargets = new Set(Object.values(TOKEN_TO_CANONICAL));
const duplicateCanonicals = [];
const synonymGroups = [];

for (const [token, target] of Object.entries(TOKEN_TO_CANONICAL)) {
  if (token !== target && KNOWN_SKILL_SLUGS.includes(token) && token !== target) {
    synonymGroups.push({ alias: token, mapsTo: target, note: "token maps away from self-canonical slug" });
  }
}

const report = {
  measuredAt: new Date().toISOString(),
  canonicalCount: listCanonicalIds().length,
  aliasEntryCount: SKILL_ALIAS_ENTRIES.length,
  uniqueAliasCount: new Set(SKILL_ALIAS_ENTRIES.map((e) => e.alias)).size,
  tokenMapSize: Object.keys(TOKEN_TO_CANONICAL).length,
  canonicals,
  resolvedSynonymGroups: synonymGroups,
  duplicateCanonicals,
  postgresNormalization: canonicals.find((c) => c.canonical === "postgres"),
};

const outPath = join(root, "scripts/audit/canonical-normalization-report.json");
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`Canonical count: ${report.canonicalCount}`);
console.log(`Alias entries:   ${report.aliasEntryCount}`);
console.log(`Saved: ${outPath}`);
