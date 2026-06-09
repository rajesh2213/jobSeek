/**
 * Phase 6 taxonomy hardening validation audit.
 * Run: cd apps/client && npx tsx ../../scripts/audit/resumeFitTaxonomyHardeningAudit.mjs
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
const { deriveJobRoleFamily, computeTitleFit } = await import(
  join(root, "apps/client/lib/resumeFitTitle.ts"),
);
const { scoreResume, clearScoreCache, candidateExperienceFromApplyProfile } = await import(
  join(root, "apps/client/lib/resumeScorer.ts"),
);

const prisma = new PrismaClient();

const BASELINE_SUSPICIOUS_FULLSTACK = 678;
const TAXONOMY_FAMILIES = [
  "software.engineering",
  "technical.operations",
  "mechanical.engineering",
  "engineering.backend",
  "engineering.frontend",
  "engineering.devops",
  "engineering.data",
  "engineering.ml",
];

const SUSPICIOUS_PATTERNS = [
  /\btechnician\b/i,
  /\bspacecraft\b/i,
  /\bfield\s+engineer\b/i,
  /\bmechanical\b/i,
  /\bassembler\b/i,
  /\bsimulator\b/i,
];

const SWE_RESUME = `
Senior Software Engineer with Python, TypeScript, React, Node.js, SQL, AWS, Kubernetes.
Built APIs and full-stack web applications.
`.trim();

const SWE_PROFILE = { currentTitle: "Software Engineer", yearsOfExperience: 5 };

function isSuspiciousTitle(title) {
  return SUSPICIOUS_PATTERNS.some((re) => re.test(title));
}

async function scoreAgainstTitle(title, category = "engineering") {
  const job = toDetailJobItem({
    id: `probe-${title.replace(/\s+/g, "-").toLowerCase()}`,
    title,
    role: category,
    category,
    skills: ["python", "typescript", "react", "sql", "aws"],
    description: `${title} role requiring Python, TypeScript, React.`,
    parsedDescription: {
      position: [],
      responsibility: ["Build software systems"],
      requirement: ["Python", "TypeScript", "React", "SQL"],
      experience: ["5+ years software engineering"],
      benefit: [],
      contact: [],
      other: [],
    },
    companyId: "x",
    experienceLevel: "senior",
  });
  clearScoreCache();
  const scored = scoreResume(SWE_RESUME, [], job, {}, SWE_PROFILE);
  const titleFit = computeTitleFit(job, { currentTitle: SWE_PROFILE.currentTitle });
  return {
    jobTitle: title,
    jobFamily: titleFit.jobFamily,
    candidateFamily: titleFit.candidateFamily,
    titleFitScore: titleFit.titleFitScore,
    finalScore: scored.score,
    matchAvailability: scored.matchAvailability,
    skillsFitScore: scored.skillsFitScore,
    confidence: scored.confidenceLevel,
  };
}

async function main() {
  const jobs = await prisma.job.findMany({
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
      experienceLevel: true,
    },
    orderBy: { listingFreshnessAt: "desc" },
  });

  const familyTitles = Object.fromEntries(TAXONOMY_FAMILIES.map((f) => [f, new Map()]));
  let suspiciousInSoftware = 0;
  let suspiciousTotal = 0;

  for (const row of jobs) {
    const job = toDetailJobItem(row);
    const derived = deriveJobRoleFamily(job);
    const title = job.title?.trim() ?? "";
    if (!title || !derived.family) continue;

    if (TAXONOMY_FAMILIES.includes(derived.family)) {
      const key = title.toLowerCase();
      const map = familyTitles[derived.family];
      map.set(key, (map.get(key) ?? 0) + 1);
    }

    if (isSuspiciousTitle(title)) {
      suspiciousTotal++;
      if (derived.family === "software.engineering") suspiciousInSoftware++;
    }
  }

  const familyStats = Object.fromEntries(
    TAXONOMY_FAMILIES.map((f) => {
      const map = familyTitles[f];
      const total = [...map.values()].reduce((a, b) => a + b, 0);
      const suspicious = [...map.entries()]
        .filter(([t]) => isSuspiciousTitle(t))
        .reduce((sum, [, c]) => sum + c, 0);
      return [
        f,
        {
          uniqueTitles: map.size,
          totalMappings: total,
          suspiciousMappings: suspicious,
          topTitles: [...map.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(([title, count]) => ({ title, count })),
        },
      ];
    }),
  );

  const probeTitles = [
    "Spacecraft Technician",
    "Field Engineer",
    "Mechanical Technician",
    "Senior Software Engineer",
    "Software Engineer",
  ];
  const probeResults = {};
  for (const t of probeTitles) {
    probeResults[t] = await scoreAgainstTitle(t);
  }

  const users = await prisma.user.findMany({
    where: { OR: [{ resumeText: { not: null } }, { resumeFileName: { not: null } }] },
    select: {
      id: true,
      currentTitle: true,
      yearsOfExperience: true,
      resumeText: true,
      resumeBullets: true,
      resumeStructuredV1: true,
      applyProfileSummary: true,
    },
    take: 6,
    orderBy: { resumeUpdatedAt: "desc" },
  });

  const jobSample = jobs.slice(0, 100).map((row) => toDetailJobItem(row));
  const highScorePairs = new Map();
  let evaluations = 0;
  let unavailable = 0;
  let scored = 0;

  for (const user of users) {
    clearScoreCache();
    const resumeText = user.resumeText?.trim() ?? "";
    const bullets = Array.isArray(user.resumeBullets)
      ? user.resumeBullets.filter((b) => typeof b === "string")
      : [];
    const profile = candidateExperienceFromApplyProfile(user);

    for (const job of jobSample) {
      evaluations++;
      const result = scoreResume(resumeText, bullets, job, {}, profile);
      if (result.matchAvailability !== "scored" || result.score == null) {
        unavailable++;
        continue;
      }
      scored++;
      if (result.score >= 75) {
        const key = `${result.candidateRoleFamily ?? "null"} → ${result.jobRoleFamily ?? "null"}`;
        highScorePairs.set(key, (highScorePairs.get(key) ?? 0) + 1);
      }
    }
  }

  const suspiciousReductionPct =
    BASELINE_SUSPICIOUS_FULLSTACK > 0
      ? (((BASELINE_SUSPICIOUS_FULLSTACK - suspiciousInSoftware) / BASELINE_SUSPICIOUS_FULLSTACK) * 100).toFixed(1)
      : "0.0";

  const successCriteria = {
    suspiciousReductionGt80Pct: Number(suspiciousReductionPct) > 80,
    spacecraftTechnicianLt50: (probeResults["Spacecraft Technician"]?.finalScore ?? 100) < 50,
    fieldEngineerLt60: (probeResults["Field Engineer"]?.finalScore ?? 100) < 60,
    sweToSweUnchanged:
      probeResults["Software Engineer"]?.titleFitScore === 100 &&
      probeResults["Senior Software Engineer"]?.titleFitScore === 100,
    unavailableLt3Pct: evaluations > 0 ? (unavailable / evaluations) * 100 < 3 : false,
  };

  const recommendation =
    successCriteria.suspiciousReductionGt80Pct &&
    successCriteria.spacecraftTechnicianLt50 &&
    successCriteria.fieldEngineerLt60 &&
    successCriteria.sweToSweUnchanged
      ? successCriteria.unavailableLt3Pct
        ? "GO"
        : "GO_WITH_NOTES"
      : "NO_GO";

  const report = {
    measuredAt: new Date().toISOString(),
    baseline: {
      engineeringFullstackSuspicious: BASELINE_SUSPICIOUS_FULLSTACK,
    },
    after: {
      suspiciousInSoftwareEngineering: suspiciousInSoftware,
      suspiciousTotalAcrossAllFamilies: suspiciousTotal,
      suspiciousReductionPct: `${suspiciousReductionPct}%`,
    },
    familyStats,
    probeResults,
    highScorePairs: [...highScorePairs.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([pair, count]) => ({ pair, count })),
    realResumeEvaluations: {
      evaluations,
      scored,
      unavailable,
      unavailablePct: evaluations ? `${((unavailable / evaluations) * 100).toFixed(1)}%` : "0%",
    },
    successCriteria,
    recommendation,
  };

  const outPath = join(root, "scripts/audit/resume-fit-taxonomy-hardening-audit.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("\n=== Phase 6 Taxonomy Hardening Audit ===\n");
  console.log(`Suspicious in software.engineering: ${suspiciousInSoftware} (was ${BASELINE_SUSPICIOUS_FULLSTACK})`);
  console.log(`Reduction: ${suspiciousReductionPct}%`);
  console.log(`Spacecraft Technician: ${probeResults["Spacecraft Technician"]?.finalScore}%`);
  console.log(`Field Engineer: ${probeResults["Field Engineer"]?.finalScore}%`);
  console.log(`SWE↔SWE title fit: ${probeResults["Software Engineer"]?.titleFitScore}`);
  console.log(`Unavailable (real resumes): ${report.realResumeEvaluations.unavailablePct}`);
  console.log(`Recommendation: ${recommendation}`);
  console.log(`\nSaved: ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
