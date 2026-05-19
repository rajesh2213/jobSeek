import Fastify, { type FastifyError } from "fastify";
import pino from "pino";
import compress from "@fastify/compress";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import prismaPlugin from "./plugins/prisma.plugin.js";
import { registerRoutes } from "./routes/index.js";
import cors from "@fastify/cors";
import fastifyRawBody from "fastify-raw-body";
import { getIoredis } from "../queues/job.queue.js";
import { registerApiRequestMetrics } from "../utils/apiRequestMetrics.js";
import {
  isListingDegradedDbError,
  sendCompaniesListingDegraded,
  sendJobsListingDegraded,
} from "../infrastructure/db/listingDegradedResponse.js";

export async function buildServer() {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    /** Required so `request.ip` reflects the client behind nginx (`X-Forwarded-For`). */
    trustProxy: true,
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
    exposedHeaders: ["x-jobloom-auth-failure-code", "x-jobloom-auth-hint"],
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "x-jobseek-view-cap-bypass",
      "x-internal-seo",
      "x-internal-seo-secret",
    ],
  });

  await server.register(compress, { global: true });

  /**
   * Global fallback safety net. Uses Redis when `REDIS_URL` is set so limits are shared
   * across processes/instances; otherwise in-memory (per-process only).
   * Route-level Redis limits (`assertJobReadRateLimit` on `/jobs`, etc.) are unchanged.
   */
  const redisUrl = process.env.REDIS_URL?.trim();
  const globalRlRedis = redisUrl ? getIoredis() : undefined;
  await server.register(rateLimit, {
    global: true,
    max: 250,
    timeWindow: "1 minute",
    nameSpace: "jobseek-global-rl-",
    ...(globalRlRedis
      ? { redis: globalRlRedis, skipOnError: true }
      : {}),
    keyGenerator: (request) => request.ip,
    onExceeded: (request, key) => {
      request.log.warn(
        {
          event: "global_rate_limit_exceeded",
          key,
          ip: request.ip,
          path: request.url.split("?")[0] ?? request.url,
          store: globalRlRedis ? "redis" : "memory",
        },
        "global_rate_limit_exceeded",
      );
    },
  });
  if (!globalRlRedis) {
    server.log.warn(
      {
        event: "global_rate_limit_store_memory",
        hint: "Set REDIS_URL for shared limits across instances",
      },
      "global_rate_limit_store_memory",
    );
  }

  registerApiRequestMetrics(server);

  server.setErrorHandler((error: FastifyError, request, reply) => {
    if (isListingDegradedDbError(error)) {
      const path = request.url.split("?")[0] ?? "";
      if (path === "/jobs") {
        const q = request.query as Record<string, unknown>;
        const pageRaw = q.page;
        const limitRaw = q.limit;
        const page =
          typeof pageRaw === "string" || typeof pageRaw === "number"
            ? Math.max(1, parseInt(String(pageRaw), 10) || 1)
            : 1;
        const limit =
          typeof limitRaw === "string" || typeof limitRaw === "number"
            ? Math.min(100, Math.max(1, parseInt(String(limitRaw), 10) || 20))
            : 20;
        request.log.warn({ event: "db_pool_exhausted", route: path }, "db_pool_exhausted");
        void sendJobsListingDegraded(reply, { page, pageSize: limit });
        return;
      }
      if (path === "/companies") {
        const q = request.query as Record<string, unknown>;
        const pageRaw = q.page;
        const limitRaw = q.limit;
        const page =
          typeof pageRaw === "string" || typeof pageRaw === "number"
            ? Math.max(1, parseInt(String(pageRaw), 10) || 1)
            : 1;
        const limit =
          typeof limitRaw === "string" || typeof limitRaw === "number"
            ? Math.min(100, Math.max(1, parseInt(String(limitRaw), 10) || 20))
            : 20;
        request.log.warn({ event: "db_pool_exhausted", route: path }, "db_pool_exhausted");
        void sendCompaniesListingDegraded(reply, { page, limit });
        return;
      }
    }

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

  const logSlowRouteMs = Number(process.env.LOG_SLOW_ROUTE_MS ?? "0");
  server.addHook("onRequest", async (request, _reply) => {
    const reqWithStart = request as typeof request & { startTime?: number };
    reqWithStart.startTime = Date.now();
  });

  if (logSlowRouteMs > 0) {
    server.addHook("onResponse", (request, reply, done) => {
      const ms = reply.elapsedTime;
      if (ms >= logSlowRouteMs) {
        const path = request.url.split("?")[0] ?? "";
        if (path.includes("/jobs")) {
          request.log.warn(
            {
              event: "slow_http_route",
              durationMs: ms,
              method: request.method,
              path,
            },
            "slow_http_route",
          );
        }
      }
      done();
    });
  }

  await server.register(prismaPlugin);
  await registerRoutes(server);

  return server;
}
