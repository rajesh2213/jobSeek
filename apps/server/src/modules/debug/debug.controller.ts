import type { FastifyInstance } from "fastify";
import { parseJobDescriptionAI } from "../ai/ai.service.js";
import type { ParsedJobDescriptionAI } from "../ai/ai.types.js";

interface DebugJobParams {
  id: string;
}

/**
 * Temporary diagnostics: compare DB `parsedDescription` vs live inference on raw `description`.
 * Enabled when `NODE_ENV !== "production"` or `ENABLE_DEBUG_JOB_ENDPOINT=true`.
 */
export function registerDebugRoutes(server: FastifyInstance): void {
  server.get<{ Params: DebugJobParams }>(
    "/debug/job/:id",
    async (request, reply) => {
      const jobId = request.params.id;
      const row = await server.prisma.job.findUnique({
        where: { id: jobId },
        select: {
          id: true,
          title: true,
          description: true,
          parsedDescription: true,
        },
      });

      if (!row) {
        return reply.status(404).send({ error: "Job not found", code: "JOB_NOT_FOUND" });
      }

      const rawDescription = row.description ?? null;
      const parsedDescriptionFromDB = row.parsedDescription ?? null;

      let parsedDescriptionFromInference: ParsedJobDescriptionAI | null = null;
      if (rawDescription?.trim()) {
        parsedDescriptionFromInference = await parseJobDescriptionAI(rawDescription, undefined, {
          jobTitle: row.title ?? null,
        });
      }

      const data = {
        jobId: row.id,
        title: row.title,
        rawDescription,
        parsedDescriptionFromDB,
        parsedDescriptionFromInference,
      };

      return reply
        .header("Content-Type", "application/json; charset=utf-8")
        .send(JSON.stringify(data, null, 2));
    },
  );
}
