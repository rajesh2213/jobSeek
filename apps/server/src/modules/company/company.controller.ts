import type { FastifyInstance } from "fastify";
import { createCompanyRepository } from "./company.repository.js";
import { CompanyService } from "./company.service.js";
import { createJobRepository } from "../job/job.repository.js";
import { registerCompanyRoutes } from "./company.routes.js";

export function createCompanyController(server: FastifyInstance): CompanyService {
  const companyRepository = createCompanyRepository(server.prisma);
  const jobRepository = createJobRepository(server.prisma);
  const companyService = new CompanyService(companyRepository, jobRepository);
  registerCompanyRoutes(server, companyService);
  return companyService;
}
