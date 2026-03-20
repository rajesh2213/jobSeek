import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createCompanyRepository } from "./company.repository.js";
import { CompanyService } from "./company.service.js";
import { createCompanyBodySchema } from "./company.schema.js";

interface CreateCompanyBody {
  name: string;
  careersUrl?: string;
  atsBoardToken?: string;
  atsType?: string;
}

export function registerCompanyRoutes(
  server: FastifyInstance,
  companyService: CompanyService
) {
  server.get("/companies", async (_request: FastifyRequest, reply: FastifyReply) => {
    const companies = await companyService.list();
    return reply.send({ data: companies });
  });

  server.post<{ Body: CreateCompanyBody }>(
    "/companies",
    { schema: createCompanyBodySchema },
    async (
      request: FastifyRequest<{ Body: CreateCompanyBody }>,
      reply: FastifyReply
    ) => {
      const company = await companyService.create({
        name: request.body.name,
        ...(request.body.careersUrl !== undefined && {
          careersUrl: request.body.careersUrl,
        }),
        ...(request.body.atsBoardToken !== undefined && {
          atsBoardToken: request.body.atsBoardToken,
        }),
        ...(request.body.atsType !== undefined && { atsType: request.body.atsType }),
      });
      return reply.status(201).send({ data: company });
    }
  );
}

export function createCompanyController(server: FastifyInstance): CompanyService {
  const repository = createCompanyRepository(server.prisma);
  const service = new CompanyService(repository);
  registerCompanyRoutes(server, service);
  return service;
}
