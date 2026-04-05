import { prisma } from "../infrastructure/db/prisma.js";
import { createCompanyRepository } from "../modules/company/company.repository.js";
import { createJobRepository } from "../modules/job/job.repository.js";
import { CompanyService } from "../modules/company/company.service.js";

/**
 * Standalone entry for workers/tests: resolve or create a company from job context.
 * Prefer `CompanyService.ensureCompanyFromJob` when a service instance already exists.
 */
export async function ensureCompanyFromJob(params: {
  preferredCompanyId?: string;
  companyName?: string;
}): Promise<{ companyId: string; created: boolean }> {
  const companyService = new CompanyService(
    createCompanyRepository(prisma),
    createJobRepository(prisma),
  );
  return companyService.ensureCompanyFromJob(params);
}
