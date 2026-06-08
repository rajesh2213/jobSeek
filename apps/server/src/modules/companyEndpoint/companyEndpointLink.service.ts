import type { AtsEndpoint, PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

/** Companies linked to an endpoint via primary owner or M:N join row. */
export async function getLinkedEndpointsForCompany(
  prisma: PrismaClient,
  companyId: string,
  opts?: { activeOnly?: boolean },
): Promise<AtsEndpoint[]> {
  const activeOnly = opts?.activeOnly ?? false;
  const activeFilter = activeOnly ? { isActive: true } : {};

  const [owned, linked] = await Promise.all([
    prisma.atsEndpoint.findMany({
      where: { companyId, ...activeFilter },
    }),
    prisma.companyAtsEndpoint.findMany({
      where: { companyId, endpoint: activeFilter },
      include: { endpoint: true },
    }),
  ]);

  const byId = new Map<string, AtsEndpoint>();
  for (const ep of owned) byId.set(ep.id, ep);
  for (const row of linked) byId.set(row.endpoint.id, row.endpoint);
  return [...byId.values()];
}

export async function companyHasActiveEndpoint(
  prisma: PrismaClient,
  companyId: string,
): Promise<boolean> {
  const [owned, linked] = await Promise.all([
    prisma.atsEndpoint.count({ where: { companyId, isActive: true } }),
    prisma.companyAtsEndpoint.count({
      where: { companyId, endpoint: { isActive: true } },
    }),
  ]);
  return owned + linked > 0;
}

export async function linkCompanyToEndpoint(
  prisma: PrismaClient,
  input: { companyId: string; endpointId: string; source?: string },
): Promise<{ linked: boolean }> {
  try {
    await prisma.companyAtsEndpoint.create({
      data: {
        companyId: input.companyId,
        endpointId: input.endpointId,
        source: input.source ?? "link",
      },
    });
    return { linked: true };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { linked: false };
    }
    throw err;
  }
}
