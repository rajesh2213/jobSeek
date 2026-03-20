import type { JobRepository } from "./job.repository.js";
import type { JobListFilters, JobWithCompany } from "./job.repository.js";
import type { NormalizedJob } from "../crawler/crawler.types.js";
import type { PaginatedResult } from "../../types/api.js";
import { Prisma } from "@prisma/client";

export interface JobListInput {
  page: number;
  limit: number;
  filters?: JobListFilters;
}

export class JobService {
  constructor(private readonly jobRepository: JobRepository) {}

  async getById(id: string): Promise<JobWithCompany | null> {
    return this.jobRepository.findById(id);
  }

  async list(input: JobListInput): Promise<PaginatedResult<JobWithCompany>> {
    const options: Parameters<JobRepository["findMany"]>[0] = {
      page: input.page,
      limit: input.limit,
    };
    if (input.filters) options.filters = input.filters;
    const { items, total } = await this.jobRepository.findMany(options);

    const totalPages = Math.ceil(total / input.limit) || 1;

    return {
      items,
      total,
      page: input.page,
      limit: input.limit,
      totalPages,
    };
  }

  async createNormalized(
    input: NormalizedJob,
  ): Promise<{ created: boolean }> {
    try {
      await this.jobRepository.create(input);
      return { created: true };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        return { created: false };
      }
      throw err;
    }
  }

  async touchLastSeenBySourceUrls(
    sourceUrls: string[],
    seenAt: Date,
  ): Promise<number> {
    return this.jobRepository.updateLastSeenBySourceUrls(sourceUrls, seenAt);
  }
}
