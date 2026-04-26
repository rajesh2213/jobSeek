import { loadRootEnv } from "../src/infrastructure/env/loadEnv.js";
import { prisma } from "../src/infrastructure/db/prisma.js";

async function main(): Promise<void> {
  loadRootEnv();
  const valid = await prisma.company.count({ where: { discoverySource: "csv_seed" } });
  const fallback = await prisma.company.count({ where: { discoverySource: "csv_seed_fallback" } });
  const fbRows = await prisma.company.findMany({
    where: { discoverySource: "csv_seed_fallback" },
    select: { domain: true },
  });
  const resolved = fbRows.filter((r) => r.domain != null && String(r.domain).trim() !== "").length;
  const unresolved = fbRows.length - resolved;
  const byPri = await prisma.company.groupBy({
    by: ["priority"],
    _count: { _all: true },
  });
  const top = await prisma.$queryRaw<
    { name: string; jobs: bigint }[]
  >`SELECT c.name, COUNT(j.id)::bigint AS jobs
    FROM "Job" j
    JOIN "Company" c ON j."companyId" = c.id
    WHERE j."canonicalJobId" IS NULL
    GROUP BY c.id, c.name
    ORDER BY jobs DESC
    LIMIT 5`;
  console.log(
    JSON.stringify(
      {
        discoverySource: { csv_seed: valid, csv_seed_fallback: fallback },
        fallback_domain: { resolved, unresolved, ratio: fallback ? resolved / fallback : 0 },
        priority: Object.fromEntries(byPri.map((p) => [p.priority, p._count._all])),
        top_companies_by_noncanonical_job_count: top.map((r) => ({
          name: r.name,
          jobs: Number(r.jobs),
        })),
      },
      null,
      0,
    ),
  );
  await prisma.$disconnect();
}

void main().catch((e) => {
  console.error("smokeQuerySnapshot failed", e);
  process.exit(1);
});
