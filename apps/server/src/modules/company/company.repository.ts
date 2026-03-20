import type { PrismaClient, Company } from "@prisma/client";

export interface CreateCompanyInput {
  name: string;
  careersUrl?: string;
  atsBoardToken?: string;
  atsType?: string;
}

export function createCompanyRepository(prisma: PrismaClient) {
  return {
    async findMany(): Promise<Company[]> {
      return prisma.company.findMany({
        orderBy: { name: "asc" },
      });
    },

    async findByAtsType(atsType: string): Promise<Company[]> {
      return prisma.company.findMany({
        where: { atsType },
        orderBy: { name: "asc" },
      });
    },

    async findByCareersUrl(careersUrl: string): Promise<Company | null> {
      return prisma.company.findFirst({ where: { careersUrl } });
    },

    async findByAtsBoardToken(atsBoardToken: string): Promise<Company | null> {
      return prisma.company.findFirst({ where: { atsBoardToken } });
    },

    async listCrawlableByAtsType(atsType: string): Promise<Company[]> {
      return prisma.company.findMany({
        where: {
          atsType,
          atsBoardToken: { not: null },
        },
        orderBy: { name: "asc" },
      });
    },

    async listCrawlableByAtsTypes(atsTypes: string[]): Promise<Company[]> {
      return prisma.company.findMany({
        where: {
          atsType: { in: atsTypes },
          atsBoardToken: { not: null },
        },
        orderBy: { name: "asc" },
      });
    },

    async findById(companyId: string): Promise<Company | null> {
      return prisma.company.findUnique({
        where: { id: companyId },
      });
    },

    async updateLastCrawledAt(
      companyId: string,
      lastCrawledAt: Date,
    ): Promise<void> {
      await prisma.company.update({
        where: { id: companyId },
        data: { lastCrawledAt },
      });
    },

    async create(input: CreateCompanyInput): Promise<Company> {
      return prisma.company.create({
        data: {
          name: input.name,
          careersUrl: input.careersUrl ?? null,
          atsBoardToken: input.atsBoardToken ?? null,
          atsType: input.atsType ?? null,
        },
      });
    },
  };
}

export type CompanyRepository = ReturnType<typeof createCompanyRepository>;
