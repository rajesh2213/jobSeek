import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [stats] = await prisma.$queryRaw<
    Array<{
      active_canonical: number;
      active_canonical_posted: number;
      with_salary_min: number;
      with_salary_max: number;
    }>
  >`
    SELECT
      COUNT(*) FILTER (WHERE "isActive" = true AND "canonicalJobId" IS NULL)::int AS active_canonical,
      COUNT(*) FILTER (WHERE "postedAt" IS NOT NULL AND "isActive" = true AND "canonicalJobId" IS NULL)::int AS active_canonical_posted,
      COUNT(*) FILTER (WHERE "salaryMin" IS NOT NULL AND "salaryMin" > 0 AND "isActive" = true AND "canonicalJobId" IS NULL)::int AS with_salary_min,
      COUNT(*) FILTER (WHERE "salaryMax" IS NOT NULL AND "salaryMax" > 0 AND "isActive" = true AND "canonicalJobId" IS NULL)::int AS with_salary_max
    FROM "Job"
  `;
  console.log(JSON.stringify(stats, null, 2));
  if (stats) {
    const pct = ((stats.active_canonical_posted / stats.active_canonical) * 100).toFixed(1);
    const salPct = ((stats.with_salary_min / stats.active_canonical) * 100).toFixed(1);
    console.log(`POSTED rate (postedAt not null): ${pct}%`);
    console.log(`salaryMin rate: ${salPct}%`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
