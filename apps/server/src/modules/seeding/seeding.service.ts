import { logger } from "../../utils/logger.js";
import { getDomainFromUrl, normalizeDomain } from "../../utils/common.js";
import type { CompanyService } from "../company/company.service.js";
import type { SeedCompany, SeedResult } from "./seeding.types.js";

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export class SeedingService {
  constructor(private readonly companyService: CompanyService) {}

  async seedCompanies(companies: SeedCompany[]): Promise<SeedResult> {
    const existingCompanies = await this.companyService.list();
    const existingDomainSet = new Set<string>();

    for (const company of existingCompanies) {
      const existingDomain = getDomainFromUrl(company.careersUrl);
      if (existingDomain) existingDomainSet.add(existingDomain);
    }

    let inserted = 0;
    let skipped = 0;

    for (const company of companies) {
      const name = normalizeName(company.name);
      const domain = normalizeDomain(company.domain);

      if (!name) {
        skipped += 1;
        continue;
      }

      const byName = await this.companyService.findByName(name);
      if (byName) {
        skipped += 1;
        logger.info({ event: "company_skipped", reason: "name_exists", name, domain }, "Seed company skipped by name");
        continue;
      }

      if (domain && existingDomainSet.has(domain)) {
        skipped += 1;
        logger.info({ event: "company_skipped", reason: "domain_exists", name, domain }, "Seed company skipped by domain");
        continue;
      }

      const careersUrl = domain ? `https://${domain}/careers` : undefined;

      await this.companyService.create({
        name,
        careersUrl,
        atsType: undefined,
        atsBoardToken: undefined,
      });

      if (domain) existingDomainSet.add(domain);
      inserted += 1;
      logger.info({ event: "company_seeded", name, domain, careersUrl }, "Seed company inserted");
    }

    return { inserted, skipped };
  }
}
