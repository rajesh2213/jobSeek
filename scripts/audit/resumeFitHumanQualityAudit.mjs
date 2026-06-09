/**
 * Read-only human quality audit for Resume Fit V2.
 * Run: cd apps/client && npx tsx ../../scripts/audit/resumeFitHumanQualityAudit.mjs
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toDetailJobItem } from "./lib/jobItemForAudit.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "apps/server/package.json"));
const { register } = await import("tsx/esm/api");
register();

const { PrismaClient } = require("@prisma/client");
const {
  MIN_JOB_MATCH_SIGNALS,
  resolveJobMatchSkillsWithMeta,
  isDescriptionFallbackKeyword,
  matchTitleFamilyLowPack,
} = await import(join(root, "apps/client/lib/jobMatchSignals.ts"));
const { scoreResume, clearScoreCache } = await import(join(root, "apps/client/lib/resumeScorer.ts"));
const { isScorableResumeKeyword } = await import(join(root, "apps/client/lib/resumeKeywordFilter.ts"));

const SAMPLE_CATEGORIES = [
  { label: "Engineering", category: "engineering" },
  { label: "Data", category: "data" },
  { label: "Product", category: "product" },
  { label: "Marketing", category: "marketing" },
  { label: "Sales", category: "sales" },
  { label: "Customer Support", category: "customer-support" },
  { label: "Healthcare", category: "healthcare" },
  { label: "Recruiting", category: "hr" },
  { label: "Finance", category: "finance" },
  { label: "Operations", category: "operations" },
];

const FORBIDDEN_EXPLICIT = new Set([
  "contributor",
  "belonging",
  "audience",
  "seeking",
  "cloudinary",
  "monday",
  "associated",
  "authentic",
  "player",
  "industries",
  "participants",
  "screen",
  "study",
  "spanning",
  "dependencies",
  "suites",
  "phases",
  "discovery",
  "implement",
  "maintain",
  "integrated",
  "campaigns",
  "demonstrated",
  "comprehensive",
  "effective",
  "environment",
  "equivalent",
  "evidence",
  "expert",
  "expertise",
]);

const DOMAIN_SIGNAL_TOKENS = new Set([
  "design",
  "engineering",
  "research",
  "communication",
  "healthcare",
  "operations",
  "sales",
  "figma",
  "notion",
  "recruiting",
  "therapy",
  "rehabilitation",
]);

const COMMON_VERBS = new Set(
  `build built building deliver drive create improve manage support ensure develop design lead analyze
communicate collaborate coordinate plan organize implement maintain monitor evaluate research write
read learn teach train hire recruit sell negotiate present report document review test debug deploy
operate install repair maintain troubleshoot schedule prioritize delegate mentor coach facilitate
`
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean),
);

const SYNTHETIC_RESUME = `
Senior professional with experience across engineering, product, data, sales, and operations.
Skills: Python, TypeScript, JavaScript, React, SQL, PostgreSQL, Kubernetes, Docker, AWS, Azure, GCP,
agile, scrum, Jira, Confluence, Figma, Tableau, Looker, analytics, machine learning, SEO, SEM,
HubSpot, Salesforce, CRM, recruiting, interviewing, patient care, healthcare, accounting, excel,
negotiation, sales pipeline, customer service, project management, safety, operations, design,
engineering, rehabilitation, therapy, sourcing, hiring, compliance, research, communication.
`.trim();

const SOFTWARE_ONLY = new Set([
  "python",
  "sql",
  "kubernetes",
  "docker",
  "typescript",
  "javascript",
  "react",
  "postgres",
  "mongodb",
  "redis",
  "aws",
  "azure",
  "gcp",
  "tableau",
  "looker",
]);

const NON_TECH_FAMILIES = new Set([
  "healthcare.therapy",
  "healthcare.clinical",
  "hr.recruiting",
  "education.teaching",
  "trades.skilled",
  "logistics.supply",
]);

function mulberry32(seed) {
  return function rand() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function percentile(nums, p) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * s.length) - 1;
  return s[Math.max(0, idx)];
}

function companyTokens(name) {
  if (!name) return [];
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function isBadGapKeyword(keyword, companyName) {
  const k = keyword.toLowerCase().trim();
  if (!k) return { bad: true, reason: "empty" };
  if (DOMAIN_SIGNAL_TOKENS.has(k)) return { bad: false, reason: null };
  if (FORBIDDEN_EXPLICIT.has(k)) return { bad: true, reason: "forbidden_explicit" };
  if (COMMON_VERBS.has(k)) return { bad: true, reason: "verb" };
  for (const t of companyTokens(companyName)) {
    if (k === t || k.includes(t)) return { bad: true, reason: "company_name" };
  }
  if (!k.includes(" ") && !isScorableResumeKeyword(k) && !isDescriptionFallbackKeyword(k)) {
    return { bad: true, reason: "non_scorable_token" };
  }
  return { bad: false, reason: null };
}

function assessSignalsReasonable(job, resolution) {
  const notes = [];
  const title = (job.title ?? "").toLowerCase();
  const signals = resolution.skills.map((s) => s.canonical);
  const sources = resolution.skills.map((s) => s.source);

  for (const s of signals) {
    const bad = isBadGapKeyword(s, job.company?.name);
    if (bad.bad) notes.push(`bad_signal:${s}:${bad.reason}`);
  }

  if (resolution.fitTier === 4) {
    const pack = matchTitleFamilyLowPack(job);
    if (!pack) notes.push("tier4_without_family_match");
    if (sources.some((s) => s !== "title_family_low")) {
      notes.push("tier4_mixed_sources");
    }
  }

  if (resolution.fitTier === 1 && !sources.some((s) => ["taxonomy", "enriched", "parsed_requirement"].includes(s))) {
    notes.push("tier1_without_structured_signals");
  }

  if (title.includes("recruiter") || title.includes("therapist") || title.includes("designer")) {
    const sw = signals.filter((s) => SOFTWARE_ONLY.has(s));
    if (sw.length >= 2) notes.push(`suspicious_software_for_title:${sw.join(",")}`);
  }

  return {
    looksReasonable: notes.length === 0,
    notes: notes.length ? notes.join("; ") : "Signals align with title and tier.",
  };
}

function assessConfidenceHonesty(job, resolution) {
  const tier = resolution.fitTier;
  const conf = resolution.confidence;
  const breakdown = resolution.sourceBreakdown;
  const signalCount = resolution.signalCount ?? resolution.skills?.length ?? 0;
  const issues = [];

  if (tier === 1 && conf !== "high") issues.push("tier1_not_high");
  if (tier === 2 && conf !== "medium") issues.push("tier2_not_medium");
  if ((tier === 3 || tier === 4) && conf !== "low" && conf !== "very_low") {
    issues.push("low_tier_not_low_confidence");
  }

  if (tier === 1 && breakdown.taxonomy + breakdown.enriched + breakdown.parsed < 3) {
    issues.push("high_confidence_sparse_structured");
  }
  if (conf === "very_low") {
    return { accurate: true, issues: [] };
  }
  if (tier === 2 && breakdown.description === 0 && breakdown.parsed === 0) {
    issues.push("medium_without_description_signals");
  }
  if (tier === 4 && breakdown.titleFamily < 1 && signalCount < MIN_JOB_MATCH_SIGNALS) {
    issues.push("tier4_insufficient_title_signals");
  }

  return {
    accurate: issues.length === 0,
    issues,
  };
}

const prisma = new PrismaClient();

async function sampleJobsByCategory(perCategory) {
  const rand = mulberry32(42);
  const picked = [];

  for (const { label, category } of SAMPLE_CATEGORIES) {
    const pool = await prisma.job.findMany({
      where: { isActive: true, isPublishable: true, category },
      select: {
        id: true,
        title: true,
        role: true,
        category: true,
        skills: true,
        description: true,
        parsedDescription: true,
        companyId: true,
        company: { select: { name: true } },
      },
      take: 500,
      orderBy: { listingFreshnessAt: "desc" },
    });
    const shuffled = shuffle(pool, rand).slice(0, perCategory);
    for (const row of shuffled) {
      picked.push({ ...row, bucket: label });
    }
  }
  return picked;
}

async function main() {
  clearScoreCache();
  const rand = mulberry32(20260609);

  const manualRows = await sampleJobsByCategory(5);
  const part1 = manualRows.map((row) => {
    const job = toDetailJobItem(row);
    job.company = { id: row.companyId, name: row.company?.name ?? "x", slug: "x" };
    const resolution = resolveJobMatchSkillsWithMeta(job);
    const assessment = assessSignalsReasonable(job, resolution);
    return {
      jobId: row.id,
      title: row.title,
      category: row.bucket,
      company: row.company?.name,
      fitTier: resolution.fitTier,
      confidence: resolution.confidence,
      signals: resolution.skills.map((s) => ({ canonical: s.canonical, source: s.source })),
      looksReasonable: assessment.looksReasonable,
      notes: assessment.notes,
    };
  });

  const scorePool = await prisma.job.findMany({
    where: { isActive: true, isPublishable: true },
    select: {
      id: true,
      title: true,
      role: true,
      category: true,
      skills: true,
      description: true,
      parsedDescription: true,
      companyId: true,
      company: { select: { name: true } },
    },
    take: 3000,
    orderBy: { listingFreshnessAt: "desc" },
  });
  const scoreRows = shuffle(scorePool, rand).slice(0, 500);

  const gapViolations = [];
  const histogram = { "0-20": 0, "20-40": 0, "40-60": 0, "60-80": 0, "80-100": 0 };
  const scores = [];

  for (const row of scoreRows) {
    const job = toDetailJobItem(row);
    job.company = { id: row.companyId, name: row.company?.name ?? "x", slug: "x" };
    const scored = scoreResume(SYNTHETIC_RESUME, [], job, {}, {
      currentTitle: "Senior Backend Engineer",
      yearsOfExperience: 8,
    });
    if (scored.score !== null) {
      scores.push(scored.score);
      const bucket =
        scored.score < 20
          ? "0-20"
          : scored.score < 40
            ? "20-40"
            : scored.score < 60
              ? "40-60"
              : scored.score < 80
                ? "60-80"
                : "80-100";
      histogram[bucket]++;
    }

    for (const chip of [...scored.matched, ...scored.partial, ...scored.missing]) {
      const bad = isBadGapKeyword(chip.keyword, row.company?.name);
      if (bad.bad) {
        gapViolations.push({
          jobId: row.id,
          title: row.title,
          company: row.company?.name,
          chipType: scored.matched.includes(chip)
            ? "matched"
            : scored.partial.includes(chip)
              ? "partial"
              : "missing",
          keyword: chip.keyword,
          reason: bad.reason,
        });
      }
    }
  }

  const tier4Jobs = [];
  for (const row of scorePool) {
    const job = toDetailJobItem(row);
    job.company = { id: row.companyId, name: row.company?.name ?? "x", slug: "x" };
    const resolution = resolveJobMatchSkillsWithMeta(job);
    if (resolution.fitTier === 4) {
      const pack = matchTitleFamilyLowPack(job);
      const signals = resolution.skills.map((s) => s.canonical);
      const suspicious = [];
      if (pack && NON_TECH_FAMILIES.has(pack.family)) {
        const sw = signals.filter((s) => SOFTWARE_ONLY.has(s));
        if (sw.length) suspicious.push(`software_on_non_tech_family:${sw.join(",")}`);
      }
      if (pack?.family === "engineering.design" || pack?.family === "engineering.generic") {
        const badForDesign = signals.filter((s) => ["tableau", "looker", "hubspot", "seo"].includes(s));
        if (badForDesign.length) suspicious.push(`marketing_tools_on_engineer:${badForDesign.join(",")}`);
      }
      if (pack?.family === "hr.recruiting") {
        const bad = signals.filter((s) => SOFTWARE_ONLY.has(s));
        if (bad.length) suspicious.push(`software_on_recruiter:${bad.join(",")}`);
      }
      tier4Jobs.push({
        jobId: row.id,
        title: row.title,
        family: pack?.family ?? null,
        expectedSkills: pack?.skills ?? [],
        signals,
        sensible: suspicious.length === 0,
        suspicious,
      });
    }
  }

  const tier4FamilyReview = SAMPLE_CATEGORIES.map(() => null);
  const familiesSeen = new Map();
  for (const j of tier4Jobs) {
    if (!familiesSeen.has(j.family)) familiesSeen.set(j.family, j);
  }

  const familyCatalog = [
    { family: "engineering.design", exampleTitle: "Mine Designer", expected: ["engineering", "safety", "operations", "design"] },
    { family: "healthcare.therapy", exampleTitle: "Physical Therapist", expected: ["rehabilitation", "therapy", "healthcare"] },
    { family: "hr.recruiting", exampleTitle: "Recruiter", expected: ["recruiting", "sourcing", "hiring"] },
    { family: "sales.account_executive", exampleTitle: "Account Executive", expected: ["sales", "crm", "pipeline", "negotiation"] },
  ];

  const tier4CatalogReview = familyCatalog.map((f) => {
    const live = [...familiesSeen.entries()].find(([k]) => k === f.family)?.[1];
    return {
      family: f.family,
      exampleTitle: f.exampleTitle,
      expectedSignals: f.expected,
      liveExample: live
        ? { title: live.title, signals: live.signals, sensible: live.sensible, suspicious: live.suspicious }
        : null,
    };
  });

  const confidenceExamples = { high: [], medium: [], low: [], very_low: [] };
  for (const row of shuffle(scorePool, mulberry32(99))) {
    const job = toDetailJobItem(row);
    job.company = { id: row.companyId, name: row.company?.name ?? "x", slug: "x" };
    const resolution = resolveJobMatchSkillsWithMeta(job);
    if (!resolution.confidence || !resolution.fitTier) continue;
    const bucket =
      resolution.confidence === "high"
        ? "high"
        : resolution.confidence === "medium"
          ? "medium"
          : resolution.confidence === "very_low"
            ? "very_low"
            : "low";
    if (confidenceExamples[bucket].length >= 20) continue;
    const honesty = assessConfidenceHonesty(job, resolution);
    confidenceExamples[bucket].push({
      jobId: row.id,
      title: row.title,
      fitTier: resolution.fitTier,
      confidence: resolution.confidence,
      sourceBreakdown: resolution.sourceBreakdown,
      topSignals: resolution.skills.slice(0, 6).map((s) => s.canonical),
      appearsAccurate: honesty.accurate,
      issues: honesty.issues,
    });
  }

  const falseConfidence = [
    ...confidenceExamples.high.filter((e) => !e.appearsAccurate),
    ...confidenceExamples.medium.filter((e) => !e.appearsAccurate),
    ...confidenceExamples.low.filter((e) => !e.appearsAccurate),
    ...confidenceExamples.very_low.filter((e) => !e.appearsAccurate),
  ];

  const unreasonableManual = part1.filter((j) => !j.looksReasonable);
  const suspiciousTier4 = tier4Jobs.filter((j) => !j.sensible);

  const clusteringNote = (() => {
    const maxBucket = Object.entries(histogram).sort((a, b) => b[1] - a[1])[0];
    const maxPct = scores.length ? (maxBucket[1] / scores.length) * 100 : 0;
    if (maxPct > 60) return `Heavy clustering in ${maxBucket[0]} (${maxPct.toFixed(1)}%)`;
    if (scores.length && percentile(scores, 95) - percentile(scores, 5) < 25) {
      return "Possible score compression (narrow p5-p95 range)";
    }
    if (median(scores) > 75) return "Possible score inflation (median > 75)";
    return "Distribution appears balanced";
  })();

  const blockers = [];
  if (gapViolations.length > 0) blockers.push(`gap_violations:${gapViolations.length}`);
  if (unreasonableManual.length > 5) blockers.push(`unreasonable_manual_samples:${unreasonableManual.length}/50`);
  if (suspiciousTier4.length > 0) blockers.push(`suspicious_tier4:${suspiciousTier4.length}`);
  if (falseConfidence.length > 3) blockers.push(`false_confidence:${falseConfidence.length}`);

  const reasonablePct = part1.length ? (part1.filter((j) => j.looksReasonable).length / part1.length) * 100 : 0;
  const phase5Targets = {
    reasonablePctGte90: reasonablePct >= 90,
    falseConfidenceLte2: falseConfidence.length <= 2,
    gapViolationsZero: gapViolations.length === 0,
    suspiciousTier4Zero: suspiciousTier4.length === 0,
  };

  const recommendation =
    phase5Targets.reasonablePctGte90 &&
    phase5Targets.falseConfidenceLte2 &&
    phase5Targets.gapViolationsZero &&
    phase5Targets.suspiciousTier4Zero
      ? "GO"
      : gapViolations.length === 0 &&
          reasonablePct >= 80 &&
          suspiciousTier4.length === 0 &&
          falseConfidence.length <= 2
        ? "GO_WITH_NOTES"
        : "NO_GO";

  const report = {
    measuredAt: new Date().toISOString(),
    recommendation,
    blockers,
    phase5Targets,
    reasonablePct: `${reasonablePct.toFixed(1)}%`,
    part1_manualSampling: {
      sampleSize: part1.length,
      reasonableCount: part1.filter((j) => j.looksReasonable).length,
      unreasonableCount: unreasonableManual.length,
      jobs: part1,
    },
    part2_gapQuality: {
      jobsScored: scoreRows.length,
      violationCount: gapViolations.length,
      targetMet: gapViolations.length === 0,
      violations: gapViolations.slice(0, 50),
    },
    part3_scoreDistribution: {
      sampleSize: scores.length,
      histogram,
      avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
      medianScore: Math.round(median(scores)),
      p95Score: Math.round(percentile(scores, 95)),
      clusteringNote,
    },
    part4_tier4Audit: {
      tier4JobCount: tier4Jobs.length,
      suspiciousCount: suspiciousTier4.length,
      suspiciousMappings: suspiciousTier4,
      catalogReview: tier4CatalogReview,
      allTier4Jobs: tier4Jobs,
    },
    part5_confidenceHonesty: {
      confidenceAppearsAccurate: falseConfidence.length === 0,
      falseConfidenceCount: falseConfidence.length,
      falseConfidenceExamples: falseConfidence.slice(0, 20),
      samplesByTier: confidenceExamples,
    },
  };

  const outPath = join(root, "scripts/audit/resumeFitHumanQualityAudit.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("\n=== Resume Fit Human Quality Audit ===\n");
  console.log(`Recommendation: ${recommendation}`);
  if (blockers.length) console.log(`Blockers: ${blockers.join(", ")}`);
  console.log(`\nPart 1: ${report.part1_manualSampling.reasonableCount}/50 reasonable`);
  console.log(`Part 2: gap violations ${gapViolations.length} (target 0)`);
  console.log(`Part 3: avg=${report.part3_scoreDistribution.avgScore} median=${report.part3_scoreDistribution.medianScore} p95=${report.part3_scoreDistribution.p95Score}`);
  console.log(`Part 3 histogram:`, histogram);
  console.log(`Part 4: tier4=${tier4Jobs.length} suspicious=${suspiciousTier4.length}`);
  console.log(`Part 5: false confidence=${falseConfidence.length}`);
  console.log(`\nSaved: ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
