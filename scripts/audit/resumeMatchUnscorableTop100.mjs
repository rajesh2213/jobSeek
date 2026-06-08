/**
 * Read-only: analyze top 100 unscorable jobs — failure reasons + recovery tiers.
 * Run: cd apps/client && npx tsx ../../scripts/audit/resumeMatchUnscorableTop100.mjs
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "apps/server/package.json"));
const { register } = await import("tsx/esm/api");
register();

const { PrismaClient } = require("@prisma/client");
const { extractJobSkills } = await import(join(root, "apps/client/lib/skillExtractor.ts"));
const { MIN_JOB_MATCH_SIGNALS } = await import(join(root, "apps/client/lib/jobMatchSignals.ts"));
const {
  getCanonicalsFromRequirementLine,
  getCanonicalsFromTextLine,
  normalizeKeywordForMatch,
} = await import(join(root, "packages/skill-constants/src/index.ts"));
const { isSparseFallbackKeyword } = await import(join(root, "apps/client/lib/jobMatchSignals.ts"));

const prisma = new PrismaClient();

const W_SPARSE_REQ = 0.65;
const W_SPARSE_RESP = 0.55;
const W_ROLE_HINT = 0.6;

const PHRASE_STOP = new Set(
  `a an the and or but if in on at to for of as is are was were be been being
it its this that these those we you our your they their them
will can could should would may must with from by not no`
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean),
);

/** Proposed V2 Tier 3 title-family packs (simulation). */
const TITLE_FAMILY_PACKS = [
  {
    family: "healthcare.clinical",
    pattern:
      /\b(physical\s*therapist|occupational\s*therapist|speech\s*therapist|registered\s*nurse|rn\b|lpn\b|cna\b|nurse\s*practitioner|physician|doctor|clinician|therapist|pharmacist|radiolog|sonograph|medical\s*assistant|clinical)\b/i,
    skills: ["patient care", "clinical documentation", "healthcare compliance", "medical records"],
  },
  {
    family: "healthcare.admin",
    pattern:
      /\b(patient\s*access|medical\s*records|health\s*information|billing\s*specialist|prior\s*auth|registration\s*clerk|intake\s*coordinator)\b/i,
    skills: ["patient registration", "medical billing", "health insurance", "customer service"],
  },
  {
    family: "sales.field",
    pattern:
      /\b(field\s*(sales|account)|account\s*executive|sales\s*representative|sales\s*rep|business\s*development|bdr\b|sdr\b)\b/i,
    skills: ["sales pipeline", "crm", "negotiation", "customer relationships"],
  },
  {
    family: "sales.retail",
    pattern:
      /\b(sales\s*associate|store\s*(floor|associate)|retail\s*associate|cashier|merchandis)\b/i,
    skills: ["retail sales", "customer service", "point of sale", "inventory"],
  },
  {
    family: "operations.manufacturing",
    pattern: /\b(assembler|assembly|machine\s*operator|production\s*worker|warehouse|forklift|manufacturing)\b/i,
    skills: ["quality control", "safety procedures", "production line", "inventory"],
  },
  {
    family: "customer.service",
    pattern:
      /\b(customer\s*(service|experience|support)|call\s*center|contact\s*center|client\s*services)\b/i,
    skills: ["customer service", "conflict resolution", "crm", "communication"],
  },
  {
    family: "education",
    pattern: /\b(teacher|instructor|tutor|professor|educator|teaching\s*assistant)\b/i,
    skills: ["curriculum", "classroom management", "student assessment", "communication"],
  },
  {
    family: "finance.accounting",
    pattern: /\b(accountant|bookkeeper|financial\s*analyst|accounts\s*payable|accounts\s*receivable|payroll)\b/i,
    skills: ["accounting", "excel", "financial reporting", "reconciliation"],
  },
  {
    family: "hr.recruiting",
    pattern: /\b(recruiter|talent\s*acquisition|hr\s*generalist|human\s*resources)\b/i,
    skills: ["recruiting", "interviewing", "applicant tracking", "onboarding"],
  },
  {
    family: "legal",
    pattern: /\b(paralegal|legal\s*assistant|attorney|lawyer|counsel)\b/i,
    skills: ["legal research", "case management", "documentation", "compliance"],
  },
  {
    family: "engineering.software",
    pattern:
      /\b(software\s*engineer|developer|programmer|devops|sre\b|full[\s-]?stack|backend|frontend|mobile\s*developer)\b/i,
    skills: ["software development", "git", "agile", "testing"],
  },
  {
    family: "engineering.other",
    pattern: /\b(engineer|technician|mechanic|electrician|maintenance)\b/i,
    skills: ["troubleshooting", "maintenance", "technical documentation", "safety"],
  },
  {
    family: "management.general",
    pattern: /\b(supervisor|team\s*lead|manager|director|coordinator|specialist)\b/i,
    skills: ["team leadership", "project coordination", "communication", "planning"],
  },
];

function emptyParsed() {
  return {
    position: [],
    responsibility: [],
    requirement: [],
    experience: [],
    benefit: [],
    contact: [],
    other: [],
  };
}

function toJobItem(row) {
  const pd = row.parsedDescription ?? emptyParsed();
  const enriched = row.enriched ?? null;
  return {
    id: row.id,
    title: row.title,
    role: row.role,
    category: row.category,
    description: row.description ?? "",
    skills: row.skills ?? [],
    parsedDescription: pd,
    enriched,
    company: { id: row.companyId, name: "x", slug: "x" },
    location: "x",
    workMode: "onsite",
    employmentType: "full_time",
    postedAt: row.postedAt?.toISOString?.() ?? null,
  };
}

function cleanToken(w) {
  return w
    .toLowerCase()
    .replace(/^[.,;:!?'"()[\]{}]+/g, "")
    .replace(/[.,;:!?'"()[\]{}]+$/g, "")
    .trim();
}

function tokenizeLine(line) {
  return line
    .replace(/[^a-zA-Z0-9\s\-+#./]/g, " ")
    .split(/\s+/)
    .map((w) => cleanToken(w))
    .filter((w) => w.length > 1 && !PHRASE_STOP.has(w));
}

function bigramsFromLine(line) {
  const words = tokenizeLine(line);
  if (words.length < 2) return [];
  const out = [];
  for (let i = 0; i + 2 <= words.length; i++) {
    out.push(`${words[i]} ${words[i + 1]}`);
  }
  return out;
}

function collectSignalsFromText(text, source, weight) {
  const byKey = new Map();
  const add = (raw) => {
    const key = normalizeKeywordForMatch(raw);
    if (!isSparseFallbackKeyword(key)) return;
    if (!byKey.has(key)) byKey.set(key, { canonical: key, source, weight });
  };

  const lines = String(text || "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    for (const { canonical } of getCanonicalsFromRequirementLine(line)) add(canonical);
    for (const token of tokenizeLine(line)) add(token);
    for (const phrase of bigramsFromLine(line)) add(phrase);
  }
  return [...byKey.values()];
}

function collectSparseFromParsed(job) {
  const parts = [];
  for (const line of job.parsedDescription?.requirement ?? []) parts.push(line);
  for (const line of job.parsedDescription?.responsibility ?? []) parts.push(line);
  for (const line of job.parsedDescription?.experience ?? []) parts.push(line);
  for (const line of job.parsedDescription?.position ?? []) parts.push(line);
  for (const line of job.parsedDescription?.other ?? []) parts.push(line);
  return collectSignalsFromText(parts.join("\n"), "sparse_parsed", W_SPARSE_REQ);
}

function collectTier2FromDescription(job) {
  return collectSignalsFromText(job.description, "description_fallback", 0.55);
}

function collectTier3FromTitleFamily(job) {
  const haystack = `${job.title} ${job.role ?? ""}`;
  const out = [];
  const seen = new Set();
  for (const pack of TITLE_FAMILY_PACKS) {
    if (!pack.pattern.test(haystack)) continue;
    for (const skill of pack.skills) {
      const key = normalizeKeywordForMatch(skill);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ canonical: key, source: "title_family", weight: W_ROLE_HINT, family: pack.family });
    }
  }
  return out;
}

function inferTitleFamily(title) {
  const haystack = title;
  for (const pack of TITLE_FAMILY_PACKS) {
    if (pack.pattern.test(haystack)) return pack.family;
  }
  return "unclassified";
}

function diagnoseFailure(job) {
  const dict = extractJobSkills(job);
  const sparse = collectSparseFromParsed(job);
  const tier2 = collectTier2FromDescription(job);
  const tier3 = collectTier3FromTitleFamily(job);

  const reasons = [];

  const skillCount = job.skills?.length ?? 0;
  const dictFromSkills = (job.skills ?? []).filter((s) => getCanonicalsFromTextLine(s).length > 0).length;
  if (skillCount === 0) reasons.push("empty_job_skills_array");
  else if (dictFromSkills === 0) reasons.push("job_skills_not_in_client_dictionary");

  const pd = job.parsedDescription ?? emptyParsed();
  const parsedLineCount =
    (pd.requirement?.length ?? 0) +
    (pd.responsibility?.length ?? 0) +
    (pd.experience?.length ?? 0) +
    (pd.position?.length ?? 0) +
    (pd.other?.length ?? 0);
  if (parsedLineCount === 0) reasons.push("empty_parsed_description_buckets");
  else if (sparse.length === 0) reasons.push("parsed_lines_have_no_scorable_tokens");

  if (!job.enriched?.techStack?.length) reasons.push("no_enriched_tech_stack");
  if (dict.length === 0 && sparse.length === 0) reasons.push("no_dictionary_or_sparse_signals");

  const roleHintPatterns = [
    /\bproduct\s*(manager|owner|lead)\b|\bpm\b/i,
    /\bdata\s*analyst\b|\banalytics\s*analyst\b/i,
    /\bmarketing\s*manager\b|\bdigital\s*marketing\b/i,
    /\bproject\s*manager\b|\bprogram\s*manager\b/i,
    /\bcustomer\s*success\b|\baccount\s*manager\b/i,
  ];
  if (!roleHintPatterns.some((p) => p.test(`${job.title} ${job.role ?? ""}`))) {
    reasons.push("title_not_in_current_role_hint_packs");
  }

  if (!job.description?.trim()) reasons.push("empty_raw_description");

  let recoveryTier = "unrecoverable";
  const tier2Count = tier2.length;
  const tier3Count = tier3.length;
  if (tier2Count >= MIN_JOB_MATCH_SIGNALS && tier3Count >= MIN_JOB_MATCH_SIGNALS) {
    recoveryTier = "tier2_preferred"; // description richer than title-only
  } else if (tier2Count >= MIN_JOB_MATCH_SIGNALS) {
    recoveryTier = "tier2";
  } else if (tier3Count >= MIN_JOB_MATCH_SIGNALS) {
    recoveryTier = "tier3";
  } else if (tier2Count > 0 || tier3Count > 0) {
    recoveryTier = "partial_needs_both"; // <3 signals each, combine in V2
  }

  // Combined tier2+tier3 simulation
  const combined = new Map();
  for (const s of [...tier2, ...tier3]) combined.set(s.canonical, s);
  if (recoveryTier === "partial_needs_both" && combined.size >= MIN_JOB_MATCH_SIGNALS) {
    recoveryTier = "tier2_plus_tier3";
  }

  return {
    dictCount: dict.length,
    sparseCount: sparse.length,
    tier2Count,
    tier3Count,
    combinedCount: combined.size,
    reasons,
    recoveryTier,
    titleFamily: inferTitleFamily(job.title),
    tier3Family: tier3[0]?.family ?? null,
  };
}

async function main() {
  const rows = await prisma.job.findMany({
    where: { isActive: true, isPublishable: true },
    select: {
      id: true,
      title: true,
      role: true,
      category: true,
      skills: true,
      parsedDescription: true,
      enriched: true,
      description: true,
      companyId: true,
      postedAt: true,
    },
    orderBy: { listingFreshnessAt: "desc" },
    take: 20000,
  });

  const unscorable = [];
  for (const row of rows) {
    const job = toJobItem(row);
    const { resolveJobMatchSkills } = await import(join(root, "apps/client/lib/jobMatchSignals.ts"));
    if (resolveJobMatchSkills(job).length > 0) continue;
    const diag = diagnoseFailure(job);
    unscorable.push({ job, diag });
  }

  const top100 = unscorable.slice(0, 100);

  const familyCounts = {};
  const categoryCounts = {};
  const reasonCounts = {};
  const recoveryCounts = {};

  const jobDetails = top100.map(({ job, diag }) => {
    familyCounts[diag.titleFamily] = (familyCounts[diag.titleFamily] ?? 0) + 1;
    categoryCounts[job.category] = (categoryCounts[job.category] ?? 0) + 1;
    recoveryCounts[diag.recoveryTier] = (recoveryCounts[diag.recoveryTier] ?? 0) + 1;
    for (const r of diag.reasons) reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;

    return {
      id: job.id,
      title: job.title,
      category: job.category,
      role: job.role,
      skillsCount: job.skills.length,
      descriptionWords: (job.description || "").split(/\s+/).filter(Boolean).length,
      parsedLines:
        (job.parsedDescription?.requirement?.length ?? 0) +
        (job.parsedDescription?.responsibility?.length ?? 0),
      failureReasons: diag.reasons,
      pipeline: {
        dictionary: diag.dictCount,
        sparseParsed: diag.sparseCount,
        tier2Description: diag.tier2Count,
        tier3TitleFamily: diag.tier3Count,
        tier2PlusTier3: diag.combinedCount,
      },
      titleFamily: diag.titleFamily,
      recoveryTier: diag.recoveryTier,
    };
  });

  const allUnscorable = unscorable.length;
  const allSample = rows.length;
  let recoverable = 0;
  for (const { diag } of unscorable) {
    if (
      ["tier2", "tier2_preferred", "tier3", "tier2_plus_tier3"].includes(diag.recoveryTier)
    ) {
      recoverable++;
    }
  }

  const topFamilies = Object.entries(familyCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([family, count]) => ({ family, count, pct: `${((count / 100) * 100).toFixed(1)}%` }));

  const topCategories = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({ category, count, pct: `${((count / 100) * 100).toFixed(1)}%` }));

  const topReasons = Object.entries(reasonCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ reason, count }));

  console.log(
    JSON.stringify(
      {
        summary: {
          jobsScanned: allSample,
          totalUnscorableInScan: allUnscorable,
          unscorablePctInScan: `${((allUnscorable / allSample) * 100).toFixed(2)}%`,
          top100Analyzed: top100.length,
          projectedRecovery: {
            recoverableJobs: recoverable,
            recoverablePctOfAllUnscorable: `${((recoverable / Math.max(1, allUnscorable)) * 100).toFixed(2)}%`,
            top100Recoverable: top100.filter((x) =>
              ["tier2", "tier2_preferred", "tier3", "tier2_plus_tier3"].includes(x.diag.recoveryTier),
            ).length,
            top100RecoverablePct: `${(
              (top100.filter((x) =>
                ["tier2", "tier2_preferred", "tier3", "tier2_plus_tier3"].includes(x.diag.recoveryTier),
              ).length /
                100) *
              100
            ).toFixed(1)}%`,
            byRecoveryTier: recoveryCounts,
            projectedUnscorableAfterV2: `${(
              ((allUnscorable - recoverable) / allSample) *
              100
            ).toFixed(2)}%`,
          },
        },
        topFailingTitleFamilies: topFamilies,
        topFailingCategories: topCategories,
        topFailureReasons: topReasons,
        jobs: jobDetails,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
