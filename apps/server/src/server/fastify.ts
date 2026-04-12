import Fastify, { type FastifyError } from "fastify";
import multipart from "@fastify/multipart";
import prismaPlugin from "./plugins/prisma.plugin.js";
import { registerRoutes } from "./routes/index.js";
import cors from "@fastify/cors";
import fastifyRawBody from "fastify-raw-body";

export async function buildServer() {
  const server = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
  });

  await server.register(fastifyRawBody, {
    field: "rawBody",
    global: false,
    encoding: false,
    runFirst: true,
  });

  await server.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024 },
  });

  // Enable CORS for the Next.js client running on a different port.
  // Without this, browsers block `fetch()` even if the API returns 200.
  await server.register(cors as never, {
    // `origin: true` reflects the request `Origin` header in
    // `Access-Control-Allow-Origin`.
    origin: true,
    credentials: false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "x-jobseek-view-cap-bypass",
    ],
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
