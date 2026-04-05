import type { AtsEndpoint, PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { logger } from "../../utils/logger.js";
import {
  disableAtsEndpointIngestion,
  isAtsEndpointIngestionEnabled,
} from "./atsEndpointReadiness.js";

export type RegisterAtsEndpointInput = {
  type: string;
  slug: string;
  baseUrl: string;
  crawlToken: string;
  companyName?: string | null;
  companyId?: string | null;
};

export function dedupeRegistrationsByTypeSlug(
  inputs: RegisterAtsEndpointInput[],
): RegisterAtsEndpointInput[] {
  const map = new Map<string, RegisterAtsEndpointInput>();
  for (const input of inputs) {
    const key = `${input.type}\0${input.slug}`;
    if (!map.has(key)) map.set(key, input);
  }
  return [...map.values()];
}

function metadataWithToken(crawlToken: string): Prisma.InputJsonValue {
  return { crawlToken };
}

export function createAtsEndpointService(prisma: PrismaClient) {
  return {
    async registerEndpoint(input: RegisterAtsEndpointInput): Promise<AtsEndpoint | null> {
      if (!isAtsEndpointIngestionEnabled()) {
        logger.warn(
          {
            event: "ats_endpoint_registration_skipped",
            type: input.type,
            slug: input.slug,
            reason: "ats_endpoint_ingestion_disabled",
          },
          "ats_endpoint_registration_skipped",
        );
        return null;
      }
      const meta = metadataWithToken(input.crawlToken);
      const enrichmentDiscoveryFields = {
        isActive: false,
        score: 5,
        source: "enrichment",
      } as const;
      const baseData = {
        baseUrl: input.baseUrl,
        metadata: meta,
        ...enrichmentDiscoveryFields,
        ...(input.companyName != null && input.companyName !== ""
          ? { companyName: input.companyName }
          : {}),
        ...(input.companyId != null ? { companyId: input.companyId } : {}),
      };

      try {
        const row = await prisma.atsEndpoint.upsert({
          where: {
            type_slug: { type: input.type, slug: input.slug },
          },
          create: {
            type: input.type,
            slug: input.slug,
            baseUrl: input.baseUrl,
            companyName: input.companyName ?? null,
            companyId: input.companyId ?? null,
            metadata: meta,
            ...enrichmentDiscoveryFields,
          },
          update: baseData,
        });
        logger.info(
          {
            event: "ats_endpoint_registered",
            endpointId: row.id,
            type: row.type,
            slug: row.slug,
          },
          "ats_endpoint_registered",
        );
        return row;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          const existing = await prisma.atsEndpoint.findUnique({
            where: { type_slug: { type: input.type, slug: input.slug } },
          });
          if (existing) {
            logger.info(
              {
                event: "ats_endpoint_registered",
                endpointId: existing.id,
                type: existing.type,
                slug: existing.slug,
              },
              "ats_endpoint_registered",
            );
            return existing;
          }
        }
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2021"
        ) {
          logger.error(
            {
              event: "ats_endpoint_table_missing",
              type: input.type,
              slug: input.slug,
              err,
            },
            "AtsEndpoint table missing — run prisma migrate",
          );
          disableAtsEndpointIngestion("register_endpoint");
          return null;
        }
        throw err;
      }
    },

    async getActiveEndpoints(
      limit: number,
      offset: number,
    ): Promise<AtsEndpoint[]> {
      return prisma.atsEndpoint.findMany({
        where: { isActive: true },
        take: limit,
        skip: offset,
        orderBy: [{ type: "asc" }, { slug: "asc" }],
      });
    },

    async markSuccess(endpointId: string): Promise<void> {
      await prisma.atsEndpoint.update({
        where: { id: endpointId },
        data: {
          lastSuccessAt: new Date(),
          lastCheckedAt: new Date(),
        },
      });
    },

    async markFailure(endpointId: string): Promise<void> {
      const row = await prisma.atsEndpoint.update({
        where: { id: endpointId },
        data: {
          lastFailureAt: new Date(),
          lastCheckedAt: new Date(),
          failureCount: { increment: 1 },
        },
        select: {
          id: true,
          failureCount: true,
          type: true,
          slug: true,
        },
      });

      if (row.failureCount >= 5) {
        const deactivated = await prisma.atsEndpoint.updateMany({
          where: { id: endpointId, isActive: true },
          data: { isActive: false },
        });
        if (deactivated.count > 0) {
          logger.info(
            {
              event: "ats_endpoint_disabled_due_to_failures",
              endpointId,
              type: row.type,
              slug: row.slug,
              failureCount: row.failureCount,
            },
            "ats_endpoint_disabled_due_to_failures",
          );
        }
      }
    },
  };
}
