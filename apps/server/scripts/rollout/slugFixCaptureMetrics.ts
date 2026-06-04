/** Rollout metrics capture only — no app logic changes. */
import { writeFileSync } from "node:fs";
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";

loadRootEnv();

async function main(): Promise<void> {
  const tag = process.argv[2] ?? "baseline";
  const out = `/home/ubuntu/jobSeek/docs/rollout/slug-fix-${tag}.json`;

  const [
    totalEndpoints,
    linkedEndpoints,
    orphanEndpoints,
    totalCompanies,
    companiesWithToken,
    companiesReady,
    distinctLinked,
    activeEndpoints,
    activeLinked,
    activeOrphans,
    readyWithToken,
    invalidTokens,
  ] = await Promise.all([
    prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*)::bigint AS c FROM "AtsEndpoint"`,
    prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*)::bigint AS c FROM "AtsEndpoint" WHERE "companyId" IS NOT NULL`,
    prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*)::bigint AS c FROM "AtsEndpoint" WHERE "companyId" IS NULL`,
    prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*)::bigint AS c FROM "Company"`,
    prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*)::bigint AS c FROM "Company" WHERE "atsBoardToken" IS NOT NULL AND TRIM("atsBoardToken") <> ''`,
    prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*)::bigint AS c FROM "Company" WHERE status = 'ready'`,
    prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(DISTINCT "companyId")::bigint AS c FROM "AtsEndpoint" WHERE "companyId" IS NOT NULL`,
    prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*)::bigint AS c FROM "AtsEndpoint" WHERE "isActive" = true`,
    prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*)::bigint AS c FROM "AtsEndpoint" WHERE "isActive" = true AND "companyId" IS NOT NULL`,
    prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*)::bigint AS c FROM "AtsEndpoint" WHERE "isActive" = true AND "companyId" IS NULL`,
    prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*)::bigint AS c FROM "Company" WHERE status = 'ready' AND "atsBoardToken" IS NOT NULL AND TRIM("atsBoardToken") <> ''`,
    prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*)::bigint AS c FROM "Company" WHERE "atsBoardToken" IN ('posting-api','embed','login','signin','api')`,
  ]);

  const collisions = await prisma.$queryRaw<
    Array<{ atsType: string | null; atsBoardToken: string | null; cnt: bigint }>
  >`
    SELECT "atsType", "atsBoardToken", COUNT(*)::bigint AS cnt
    FROM "Company"
    WHERE "atsBoardToken" IS NOT NULL AND TRIM("atsBoardToken") <> ''
    GROUP BY "atsType", "atsBoardToken"
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
    LIMIT 100
  `;

  const badCollisions = await prisma.$queryRaw<
    Array<{ atsType: string | null; atsBoardToken: string | null; cnt: bigint }>
  >`
    SELECT "atsType", "atsBoardToken", COUNT(*)::bigint AS cnt
    FROM "Company"
    WHERE "atsBoardToken" IN ('posting-api','embed','login','signin','api')
    GROUP BY "atsType", "atsBoardToken"
    ORDER BY COUNT(*) DESC
  `;

  const payload = {
    capturedAt: new Date().toISOString(),
    tag,
    metrics: {
      totalEndpoints: Number(totalEndpoints[0]?.c ?? 0),
      linkedEndpoints: Number(linkedEndpoints[0]?.c ?? 0),
      orphanEndpoints: Number(orphanEndpoints[0]?.c ?? 0),
      totalCompanies: Number(totalCompanies[0]?.c ?? 0),
      companiesWithToken: Number(companiesWithToken[0]?.c ?? 0),
      companiesReady: Number(companiesReady[0]?.c ?? 0),
      distinctLinkedCompanies: Number(distinctLinked[0]?.c ?? 0),
      activeEndpoints: Number(activeEndpoints[0]?.c ?? 0),
      activeLinked: Number(activeLinked[0]?.c ?? 0),
      activeOrphans: Number(activeOrphans[0]?.c ?? 0),
      readyWithToken: Number(readyWithToken[0]?.c ?? 0),
      invalidTokens: Number(invalidTokens[0]?.c ?? 0),
    },
    collisions: collisions.map((c) => ({
      atsType: c.atsType,
      atsBoardToken: c.atsBoardToken,
      count: Number(c.cnt),
    })),
    badTokenGroups: badCollisions.map((c) => ({
      atsType: c.atsType,
      atsBoardToken: c.atsBoardToken,
      count: Number(c.cnt),
    })),
  };

  writeFileSync(out, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload.metrics, null, 2));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
