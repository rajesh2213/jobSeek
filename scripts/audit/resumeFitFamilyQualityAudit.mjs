/**
 * Phase 5.2 Parts B+C — engineering family taxonomy quality + split recommendations.
 * Run: cd apps/client && npx tsx ../../scripts/audit/resumeFitFamilyQualityAudit.mjs
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
const { deriveJobRoleFamily } = await import(join(root, "apps/client/lib/resumeFitTitle.ts"));

const prisma = new PrismaClient();

const ENGINEERING_FAMILIES = [
  "engineering.backend",
  "engineering.frontend",
  "engineering.fullstack",
  "engineering.devops",
  "engineering.data",
  "engineering.ml",
];

const SUSPICIOUS_TITLE_PATTERNS = [
  { re: /\btechnician\b/i, label: "technician" },
  { re: /\bmechanical\b/i, label: "mechanical" },
  { re: /\bassembler\b/i, label: "assembler" },
  { re: /\bfield\s+(engineer|technician)\b/i, label: "field_ops" },
  { re: /\bspacecraft\b/i, label: "spacecraft" },
  { re: /\bmanufacturing\b/i, label: "manufacturing" },
  { re: /\bwarehouse\b/i, label: "warehouse" },
  { re: /\bcnc\b/i, label: "cnc" },
  { re: /\belectrician\b/i, label: "electrician" },
  { re: /\bmaintenance\b/i, label: "maintenance" },
  { re: /\bquality\s+(inspector|technician)\b/i, label: "quality_ops" },
  { re: /\bproduction\b/i, label: "production" },
];

function titleKey(title) {
  return (title ?? "").trim().toLowerCase();
}

function isSuspiciousTitle(title) {
  const flags = [];
  for (const { re, label } of SUSPICIOUS_TITLE_PATTERNS) {
    if (re.test(title)) flags.push(label);
  }
  return flags;
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

  const familyTitles = Object.fromEntries(ENGINEERING_FAMILIES.map((f) => [f, new Map()]));
  const familySuspicious = Object.fromEntries(ENGINEERING_FAMILIES.map((f) => [f, []]));
  const categoryFallbackCount = { engineering: 0, other: 0 };

  for (const row of jobs) {
    const job = toDetailJobItem(row);
    const derived = deriveJobRoleFamily(job);
    if (!ENGINEERING_FAMILIES.includes(derived.family)) continue;

    const t = job.title?.trim() ?? "";
    if (!t) continue;

    const key = titleKey(t);
    const entry = familyTitles[derived.family];
    entry.set(key, (entry.get(key) ?? 0) + 1);

    if (derived.source === "category" && row.category === "engineering") {
      categoryFallbackCount.engineering++;
    }

    const flags = isSuspiciousTitle(t);
    if (flags.length) {
      familySuspicious[derived.family].push({
        title: t,
        jobId: job.id,
        category: row.category,
        source: derived.source,
        flags,
      });
    }
  }

  const familyTopTitles = {};
  for (const family of ENGINEERING_FAMILIES) {
    const sorted = [...familyTitles[family].entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([title, count]) => ({ title, count }));
    familyTopTitles[family] = sorted.map((x) => x.title);
  }

  const fullstackSuspicious = familySuspicious["engineering.fullstack"];
  const fullstackUniqueTitles = familyTitles["engineering.fullstack"].size;
  const fullstackTotalJobs = [...familyTitles["engineering.fullstack"].values()].reduce(
    (a, b) => a + b,
    0,
  );

  const recommendedSplits = [];

  if (fullstackSuspicious.length >= 3 || fullstackUniqueTitles > 80) {
    recommendedSplits.push({
      currentFamily: "engineering.fullstack",
      issue: "Excessive breadth — catch-all for generic \\bengineer\\b pattern and engineering category fallback",
      suspiciousCount: fullstackSuspicious.length,
      uniqueTitles: fullstackUniqueTitles,
      totalJobMappings: fullstackTotalJobs,
      proposedFamilies: [
        {
          id: "software.engineering",
          description: "Software developers, SWE, full-stack, application engineers",
          patterns: ["software engineer", "developer", "programmer", "full stack", "fullstack"],
        },
        {
          id: "technical.operations",
          description: "Technicians, field ops, spacecraft/mechanical production roles",
          patterns: ["technician", "spacecraft", "mechanical", "assembler", "field engineer", "manufacturing"],
        },
        {
          id: "mechanical.engineering",
          description: "Mechanical, aerospace hardware, CNC, production engineering (non-software)",
          patterns: ["mechanical engineer", "aerospace", "cnc", "manufacturing engineer"],
        },
      ],
      priority: "high",
    });
  }

  const devopsSuspicious = familySuspicious["engineering.devops"];
  if (devopsSuspicious.some((s) => s.flags.includes("field_ops"))) {
    recommendedSplits.push({
      currentFamily: "engineering.devops",
      issue: "Field engineer roles may map to devops via platform/sre patterns",
      suspiciousCount: devopsSuspicious.length,
      proposedFamilies: [
        { id: "technical.operations", description: "Separate field/hardware ops from cloud devops" },
      ],
      priority: "medium",
    });
  }

  const report = {
    measuredAt: new Date().toISOString(),
    jobsScanned: jobs.length,
    engineeringCategoryFallbackCount: categoryFallbackCount.engineering,
    familyTopTitles,
    familyStats: Object.fromEntries(
      ENGINEERING_FAMILIES.map((f) => [
        f,
        {
          uniqueTitles: familyTitles[f].size,
          totalMappings: [...familyTitles[f].values()].reduce((a, b) => a + b, 0),
          suspiciousCount: familySuspicious[f].length,
        },
      ]),
    ),
    suspiciousMembers: Object.fromEntries(
      ENGINEERING_FAMILIES.map((f) => [
        f,
        familySuspicious[f]
          .sort((a, b) => a.title.localeCompare(b.title))
          .slice(0, 40),
      ]),
    ),
    recommendedSplits,
    spacecraftTechnician: familySuspicious["engineering.fullstack"].find((s) =>
      /spacecraft\s+technician/i.test(s.title),
    ) ?? null,
  };

  const outPath = join(root, "scripts/audit/resume-fit-family-quality-audit.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("\n=== Phase 5.2 Parts B+C — Family Quality Audit ===\n");
  for (const f of ENGINEERING_FAMILIES) {
    const st = report.familyStats[f];
    console.log(`${f}: ${st.uniqueTitles} titles, ${st.suspiciousCount} suspicious`);
  }
  console.log(`\nRecommended splits: ${recommendedSplits.length}`);
  if (report.spacecraftTechnician) {
    console.log(`Spacecraft Technician → ${report.spacecraftTechnician.source} (${report.spacecraftTechnician.flags.join(", ")})`);
  }
  console.log(`\nSaved: ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
