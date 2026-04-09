import type { FastifyInstance } from "fastify";
import { resolveClerkUser } from "../../infrastructure/auth/clerkVerify.js";
import {
  getUserSavedSearchCount,
  isValidQuery,
  normalizeQuery,
} from "./savedSearch.service.js";

export function registerSavedSearchRoutes(server: FastifyInstance): void {
  server.post<{ Body: { query?: string; name?: string } }>("/saved-searches", async (request, reply) => {
    const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
    if (!ctx) {
      return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    }

    const rawQuery = typeof request.body?.query === "string" ? request.body.query : "";
    const rawName = typeof request.body?.name === "string" ? request.body.name.trim() : "";

    let query: string;
    try {
      query = normalizeQuery(rawQuery);
    } catch {
      return reply.status(400).send({ error: "Invalid query", code: "INVALID_QUERY" });
    }

    if (!isValidQuery(query)) {
      return reply.status(400).send({ error: "Invalid query", code: "INVALID_QUERY" });
    }

    const existing = await server.prisma.savedSearch.findUnique({
      where: {
        userId_query: { userId: ctx.internalUserId, query },
      },
    });
    if (existing) {
      return reply.send({
        data: {
          id: existing.id,
          name: existing.name,
          query: existing.query,
          createdAt: existing.createdAt.toISOString(),
          updatedAt: existing.updatedAt.toISOString(),
        },
      });
    }

    const count = await getUserSavedSearchCount(server.prisma, ctx.internalUserId);
    if (count >= 3) {
      return reply
        .status(409)
        .send({ error: "Saved search limit reached", code: "SAVED_SEARCH_LIMIT_REACHED" });
    }

    const created = await server.prisma.savedSearch.create({
      data: {
        userId: ctx.internalUserId,
        name: rawName || null,
        query,
      },
    });

    return reply.status(201).send({
      data: {
        id: created.id,
        name: created.name,
        query: created.query,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      },
    });
  });

  server.get("/saved-searches", async (request, reply) => {
    const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
    if (!ctx) {
      return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    }

    const rows = await server.prisma.savedSearch.findMany({
      where: { userId: ctx.internalUserId },
      orderBy: { createdAt: "desc" },
    });

    return reply.send({
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        query: row.query,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      meta: { count: rows.length, limit: 3 },
    });
  });

  server.delete<{ Params: { id: string } }>("/saved-searches/:id", async (request, reply) => {
    const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
    if (!ctx) {
      return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    }

    const id = request.params.id;
    const result = await server.prisma.savedSearch.deleteMany({
      where: { id, userId: ctx.internalUserId },
    });

    if (result.count === 0) {
      return reply
        .status(404)
        .send({ error: "Saved search not found", code: "SAVED_SEARCH_NOT_FOUND" });
    }

    return reply.send({ success: true });
  });

  server.patch<{ Params: { id: string }; Body: { name?: string | null } }>(
    "/saved-searches/:id",
    async (request, reply) => {
      const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
      if (!ctx) {
        return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
      }

      const id = request.params.id;
      const rawName =
        typeof request.body?.name === "string"
          ? request.body.name.trim()
          : null;
      const name = rawName && rawName.length > 0 ? rawName.slice(0, 80) : null;

      const result = await server.prisma.savedSearch.updateMany({
        where: { id, userId: ctx.internalUserId },
        data: { name },
      });

      if (result.count === 0) {
        return reply
          .status(404)
          .send({ error: "Saved search not found", code: "SAVED_SEARCH_NOT_FOUND" });
      }

      const row = await server.prisma.savedSearch.findUnique({ where: { id } });
      if (!row) {
        return reply
          .status(404)
          .send({ error: "Saved search not found", code: "SAVED_SEARCH_NOT_FOUND" });
      }

      return reply.send({
        data: {
          id: row.id,
          name: row.name,
          query: row.query,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        },
      });
    },
  );
}
