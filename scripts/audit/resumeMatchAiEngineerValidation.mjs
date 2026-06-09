/**
 * Phase 2.1: AI/ML engineer title-family validation.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const { register } = await import("tsx/esm/api");
register();

const { resolveJobMatchSkillsWithMeta } = await import(
  join(root, "apps/client/lib/jobMatchSignals.ts")
);

const TITLES = [
  "AI Engineer",
  "Senior AI Engineer",
  "Lead AI Engineer",
  "Staff AI Engineer",
  "Principal AI Engineer",
  "Machine Learning Engineer",
  "ML Engineer",
];

function emptyJob(title) {
  const preview = "Engineering role on a product team.";
  return {
    id: "title-test",
    title,
    role: "engineering",
    skills: [],
    description: null,
    previewLines: [preview],
    parsedDescription: {
      position: [],
      responsibility: [],
      requirement: [],
      experience: [],
      benefit: [],
      contact: [],
      other: [],
    },
    enriched: null,
    company: { id: "x", name: "x", slug: "x" },
    location: "x",
    workMode: "onsite",
    employmentType: "full_time",
    postedAt: null,
  };
}

const results = TITLES.map((title) => {
  const resolution = resolveJobMatchSkillsWithMeta(emptyJob(title));
  const titleFamily = resolution.skills.filter(
    (s) => s.source === "title_family" || s.source === "role_hint",
  );
  return {
    title,
    matched: resolution.skills.length >= 3,
    family: titleFamily.length > 0 ? "engineering.ai" : null,
    signalCount: resolution.skills.length,
    fitTier: resolution.fitTier,
    confidence: resolution.confidence,
    signals: resolution.skills.map((s) => ({ canonical: s.canonical, source: s.source })),
    needsParsedDescription: false,
  };
});

const outPath = join(root, "scripts/audit/resumeMatchAiEngineerValidation.json");
writeFileSync(outPath, JSON.stringify({ measuredAt: new Date().toISOString(), results }, null, 2));

console.log("\n=== AI Engineer Title Family Validation ===\n");
for (const r of results) {
  console.log(`${r.matched ? "✓" : "✗"} ${r.title} — ${r.signalCount} signals tier ${r.fitTier}`);
}
console.log(`\nSaved: ${outPath}`);
