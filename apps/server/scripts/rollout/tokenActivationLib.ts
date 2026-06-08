import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

/** Proven board types for safe production activation (Class B scope). */
export const ACTIVATION_CRAWLABLE_TYPES = ["greenhouse", "lever", "ashby", "workday"] as const;

export type TokenCompanyRow = {
  id: string;
  name: string;
  atsType: string | null;
  atsBoardToken: string | null;
  careersUrl: string | null;
  status: string;
  discoverySource: string | null;
};

export async function fetchTokenCompaniesWithoutActiveEndpoint(
  prisma: PrismaClient,
  limit: number,
): Promise<TokenCompanyRow[]> {
  const types = Prisma.join(ACTIVATION_CRAWLABLE_TYPES.map((t) => Prisma.sql`${t}`));
  return prisma.$queryRaw<TokenCompanyRow[]>`
    SELECT
      c.id,
      c.name,
      c."atsType",
      c."atsBoardToken",
      c."careersUrl",
      c.status::text AS status,
      c."discoverySource"
    FROM "Company" c
    WHERE c."atsType" IN (${types})
      AND c."atsBoardToken" IS NOT NULL
      AND TRIM(c."atsBoardToken") <> ''
      AND NOT EXISTS (
        SELECT 1 FROM "AtsEndpoint" e
        WHERE e."companyId" = c.id AND e."isActive" = true
      )
      AND NOT EXISTS (
        SELECT 1 FROM "CompanyAtsEndpoint" l
        JOIN "AtsEndpoint" e ON e.id = l."endpointId"
        WHERE l."companyId" = c.id AND e."isActive" = true
      )
      AND (c."discoverySource" IS NULL OR c."discoverySource" NOT LIKE '%class_b_activation:token_wired%')
    ORDER BY c.status ASC, c.name ASC
    LIMIT ${limit}
  `;
}
