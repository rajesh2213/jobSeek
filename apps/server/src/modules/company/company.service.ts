import type { Company } from "@prisma/client";
import type { CompanyRepository } from "./company.repository.js";
import type { CreateCompanyInput } from "./company.repository.js";

export class CompanyService {
  constructor(private readonly companyRepository: CompanyRepository) {}

  async list(): Promise<Company[]> {
    return this.companyRepository.findMany();
  }

  async listByAtsType(atsType: string): Promise<Company[]> {
    return this.companyRepository.findByAtsType(atsType);
  }

  async listCrawlableByAtsType(atsType: string): Promise<Company[]> {
    return this.companyRepository.listCrawlableByAtsType(atsType);
  }

  async listCrawlableByAtsTypes(atsTypes: string[]): Promise<Company[]> {
    return this.companyRepository.listCrawlableByAtsTypes(atsTypes);
  }

  async create(input: CreateCompanyInput): Promise<Company> {
    return this.companyRepository.create(input);
  }

  async findByCareersUrl(careersUrl: string): Promise<Company | null> {
    return this.companyRepository.findByCareersUrl(careersUrl);
  }

  async findByAtsBoardToken(
    atsBoardToken: string,
  ): Promise<Company | null> {
    return this.companyRepository.findByAtsBoardToken(atsBoardToken);
  }

  async markCrawled(companyId: string, crawledAt: Date): Promise<void> {
    await this.companyRepository.updateLastCrawledAt(companyId, crawledAt);
  }

  async findById(companyId: string): Promise<Company | null> {
    return this.companyRepository.findById(companyId);
  }
}
