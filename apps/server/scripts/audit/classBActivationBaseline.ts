/**
 * Phase 1: Class B activation baseline audit.
 * Usage: cd apps/server && npx tsx scripts/audit/classBActivationBaseline.ts
 */
import { writeFileSync } from "node:fs";
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";
import { fetchRecoveredCompanies } from "../rollout/classBActivationLib.js";

loadRootEnv();

async function main(): Promise<void> {
  const companies = await fetchRecoveredCompanies(prisma);

  const rows: Array<Record<string, unknown>> = [];

  for (const c of companies) {
    const endpoints = await prisma.atsEndpoint.findMany({
      where: { companyId: c.id },
      select: { id: true, type: true, slug: true, isActive: true, companyId: true },
    });

    const jobCount = await prisma.job.count({ where: { companyId: c.id } });
    const readyJobCount = await prisma.job.count({
      where: { companyId: c.id, status: "ready", isActive: true },
    });

    const orphanMatch =
      c.atsType && c.atsBoardToken
        ? await prisma.atsEndpoint.findFirst({
            where: {
              type: c.atsType,
              slug: c.atsBoardToken,
              companyId: null,
            },
            select: { id: true, slug: true, isActive: true },
          })
        : null;

    rows.push({
      id: c.id,
      name: c.name,
      atsType: c.atsType,
      atsBoardToken: c.atsBoardToken?.slice(0, 80),
      status: c.status,
      endpointExists: endpoints.length > 0,
      endpointLinked: endpoints.some((e) => e.companyId === c.id),
      endpointActive: endpoints.some((e) => e.isActive),
      endpointCount: endpoints.length,
      endpoints: endpoints.map((e) => ({
        id: e.id,
        type: e.type,
        slug: e.slug,
        isActive: e.isActive,
      })),
      orphanSlugMatch: orphanMatch
        ? { id: orphanMatch.id, slug: orphanMatch.slug, isActive: orphanMatch.isActive }
        : null,
      jobsTotal: jobCount,
      jobsReadyActive: readyJobCount,
    });
  }

  const summary = {
    recoveredCompanies: companies.length,
    withEndpoint: rows.filter((r) => r.endpointExists).length,
    withActiveEndpoint: rows.filter((r) => r.endpointActive).length,
    withJobs: rows.filter((r) => (r.jobsTotal as number) > 0).length,
    withReadyJobs: rows.filter((r) => (r.jobsReadyActive as number) > 0).length,
    orphanSlugMatches: rows.filter((r) => r.orphanSlugMatch).length,
  };

  const md = `# Class B Activation Baseline

Generated: ${new Date().toISOString()}

## Population

Recovered companies (\`discoverySource\` contains \`class_b_token_recovery:recovered\`): **${summary.recoveredCompanies}**

| Metric | Count |
|--------|------:|
| Has any endpoint row | ${summary.withEndpoint} |
| Has active endpoint | ${summary.withActiveEndpoint} |
| Has jobs | ${summary.withJobs} |
| Has ready+active jobs | ${summary.withReadyJobs} |
| Orphan slug match (type+token as slug) | ${summary.orphanSlugMatches} |

## Per company

| Company | ATS | Token | Status | Endpoint | Active | Jobs | Ready jobs |
|---------|-----|-------|--------|----------|--------|------|------------|
${rows
  .map(
    (r) =>
      `| ${r.name} | ${r.atsType} | ${(r.atsBoardToken as string) ?? "—"} | ${r.status} | ${r.endpointExists ? "yes" : "no"} | ${r.endpointActive ? "yes" : "no"} | ${r.jobsTotal} | ${r.jobsReadyActive} |`,
  )
  .join("\n")}

`;

  const jsonPath = "/home/ubuntu/jobSeek/docs/audit/class-b-activation-baseline.json";
  const mdPath = "/home/ubuntu/jobSeek/docs/rollout/class-b-activation-baseline.md";
  writeFileSync(jsonPath, JSON.stringify({ summary, companies: rows }, null, 2));
  writeFileSync(mdPath, md);

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Wrote ${mdPath}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
