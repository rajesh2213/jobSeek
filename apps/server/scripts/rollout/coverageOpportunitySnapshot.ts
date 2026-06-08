import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";
loadRootEnv();
async function main() {
  const r = await prisma.$queryRaw<
    Array<Record<string, bigint>>
  >`
    SELECT
      (SELECT COUNT(*)::bigint FROM "Company") AS total,
      (SELECT COUNT(DISTINCT cid)::bigint FROM (
        SELECT "companyId" AS cid FROM "AtsEndpoint" WHERE "companyId" IS NOT NULL
        UNION
        SELECT "companyId" AS cid FROM "CompanyAtsEndpoint"
      ) x) AS with_endpoint,
      (SELECT COUNT(DISTINCT cid)::bigint FROM (
        SELECT e."companyId" AS cid FROM "AtsEndpoint" e WHERE e."companyId" IS NOT NULL AND e."isActive" = true
        UNION
        SELECT l."companyId" AS cid FROM "CompanyAtsEndpoint" l
        JOIN "AtsEndpoint" e ON e.id = l."endpointId" WHERE e."isActive" = true
      ) x) AS with_active_ep,
      (SELECT COUNT(*)::bigint FROM "Company" c WHERE "atsType" IN ('greenhouse','lever','ashby','workday') AND ("atsBoardToken" IS NULL OR TRIM("atsBoardToken")='') AND NOT EXISTS (
        SELECT 1 FROM "AtsEndpoint" e WHERE e."companyId"=c.id AND e."isActive"=true
      ) AND NOT EXISTS (
        SELECT 1 FROM "CompanyAtsEndpoint" l JOIN "AtsEndpoint" e ON e.id=l."endpointId" WHERE l."companyId"=c.id AND e."isActive"=true
      )) AS class_b_crawlable_no_token,
      (SELECT COUNT(*)::bigint FROM "Company" c WHERE "atsType" IN ('greenhouse','lever','ashby','workday') AND "atsBoardToken" IS NOT NULL AND TRIM("atsBoardToken")<>'' AND NOT EXISTS (
        SELECT 1 FROM "AtsEndpoint" e WHERE e."companyId"=c.id AND e."isActive"=true
      ) AND NOT EXISTS (
        SELECT 1 FROM "CompanyAtsEndpoint" l JOIN "AtsEndpoint" e ON e.id=l."endpointId" WHERE l."companyId"=c.id AND e."isActive"=true
      )) AS has_token_no_active_ep,
      (SELECT COUNT(*)::bigint FROM "AtsEndpoint" WHERE "companyId" IS NULL AND "isActive"=true) AS orphan_active,
      (SELECT COUNT(*)::bigint FROM "Company" WHERE "discoverySource" LIKE '%class_b_token_recovery:recovered%' AND NOT EXISTS (
        SELECT 1 FROM "AtsEndpoint" e WHERE e."companyId"="Company".id AND e."isActive"=true
      ) AND NOT EXISTS (
        SELECT 1 FROM "CompanyAtsEndpoint" l JOIN "AtsEndpoint" e ON e.id=l."endpointId" WHERE l."companyId"="Company".id AND e."isActive"=true
      )) AS recovered_not_active
  `;
  const o = r[0]!;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(o)) out[k] = Number(v);
  console.log(JSON.stringify(out, null, 2));
  await prisma.$disconnect();
}
main();
