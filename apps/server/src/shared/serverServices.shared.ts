import { prisma } from "../infrastructure/db/prisma.js";
import { createJobRepository } from "../modules/job/job.repository.js";
import { JobService } from "../modules/job/job.service.js";
import { createCompanyRepository } from "../modules/company/company.repository.js";
import { CompanyService } from "../modules/company/company.service.js";

let jobServiceSingleton: JobService | undefined;
let companyServiceSingleton: CompanyService | undefined;

/** Same wiring as Fastify controllers — single Prisma instance process-wide. */
export function getSharedJobService(): JobService {
  jobServiceSingleton ??= new JobService(createJobRepository(prisma));
  return jobServiceSingleton;
}

export function getSharedCompanyService(): CompanyService {
  companyServiceSingleton ??= new CompanyService(
    createCompanyRepository(prisma),
    createJobRepository(prisma),
  );
  return companyServiceSingleton;
}
