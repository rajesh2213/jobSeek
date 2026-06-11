import { PrismaClient } from "@prisma/client";
import { cache } from "react";

const globalForPrisma = globalThis as unknown as { companySlugPrisma?: PrismaClient };

function prismaClient(): PrismaClient {
  if (!globalForPrisma.companySlugPrisma) {
    globalForPrisma.companySlugPrisma = new PrismaClient();
  }
  return globalForPrisma.companySlugPrisma;
}

async function queryCompanySlugByIdViaDb(companyId: string): Promise<string | null> {
  const row = await prismaClient().company.findUnique({
    where: { id: companyId },
    select: { slug: true },
  });
  const slug = row?.slug?.trim() ?? "";
  return slug.length > 0 ? slug : null;
}

async function queryCompanySlugById(companyId: string): Promise<string | null> {
  const id = companyId.trim();
  if (!id) return null;

  try {
    return await queryCompanySlugByIdViaDb(id);
  } catch {
    return null;
  }
}

/** Deduped per request when used from RSC page loaders / generateMetadata. */
export const loadCompanySlugById = cache(queryCompanySlugById);
