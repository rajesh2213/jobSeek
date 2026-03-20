import Fastify, { type FastifyError } from "fastify";
import prismaPlugin from "./plugins/prisma.plugin.js";
import { registerRoutes } from "./routes/index.js";

export async function buildServer() {
  const server = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
  });

  server.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const message = statusCode >= 500 ? "Internal server error" : error.message;
    if (statusCode >= 500) {
      server.log.error(error, "Unhandled error");
    }
    void reply.status(statusCode).send({
      error: message,
      code: error.code ?? "INTERNAL_ERROR",
    });
  });

  await server.register(prismaPlugin);
  await registerRoutes(server);

  return server;
}
