import { PrismaClient, Prisma } from "@prisma/client";
import type { Job } from "@prisma/client";

import type { NormalizedJob } from "../crawler/crawler.types.js";

export interface JobListFilters {
  location?: string;
  isRemote?: boolean;
  companyId?: string;
}

export interface JobListOptions {
  page: number;
  limit: number;
  filters?: JobListFilters;
}

export interface JobWithCompany extends Job {
  company: { id: string; name: string };
}

export function createJobRepository(prisma: PrismaClient) {
  return {
    async findById(id: string): Promise<JobWithCompany | null> {
      return prisma.job.findUnique({
        where: { id },
        include: { company: { select: { id: true, name: true } } },
      });
    },

    async findMany(options: JobListOptions): Promise<{
      items: JobWithCompany[];
      total: number;
    }> {
      const { page, limit, filters = {} } = options;
      const where: Prisma.JobWhereInput = {};

      if (filters.location !== undefined && filters.location !== "") {
        where.location = { contains: filters.location, mode: "insensitive" };
      }
      if (filters.isRemote !== undefined) {
        where.isRemote = filters.isRemote;
      }
      if (filters.companyId !== undefined && filters.companyId !== "") {
        where.companyId = filters.companyId;
      }

      const [items, total] = await Promise.all([
        prisma.job.findMany({
          where,
          include: { company: { select: { id: true, name: true } } },
          orderBy: { postedAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.job.count({ where }),
      ]);

      return { items, total };
    },

    async create(input: NormalizedJob): Promise<Job> {
      return prisma.job.create({
        data: {
          title: input.title,
          companyId: input.companyId,
          location: input.location ?? null,
          isRemote: input.isRemote,
          description: input.description ?? null,
          source: input.source,
          sourceUrl: input.sourceUrl,
          postedAt: input.postedAt ?? null,
          lastSeenAt: new Date(),
        },
      });
    },

    async updateLastSeenBySourceUrl(sourceUrl: string, lastSeenAt: Date): Promise<void> {
      await prisma.job.update({
        where: { sourceUrl },
        data: { lastSeenAt },
      });
    },

    async updateLastSeenBySourceUrls(
      sourceUrls: string[],
      lastSeenAt: Date,
    ): Promise<number> {
      if (sourceUrls.length === 0) return 0;
      const result = await prisma.job.updateMany({
        where: { sourceUrl: { in: sourceUrls } },
        data: { lastSeenAt },
      });
      return result.count;
    },
  };
}

export type JobRepository = ReturnType<typeof createJobRepository>;
