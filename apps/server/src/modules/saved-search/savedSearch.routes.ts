import type { FastifyInstance } from "fastify";
import type { SavedSearch } from "@prisma/client";
import { resolveClerkUser } from "../../infrastructure/auth/clerkVerify.js";
import { verifyJobAlertUnsubscribeToken } from "../../utils/jobAlertToken.js";
import { getPlanLimits } from "../../config/plans.js";
import { isUserPro, resolveProPlan } from "../../utils/userPlan.js";
import {
  getUserSavedSearchCount,
  isValidQuery,
  normalizeQuery,
  resolveDefaultSavedSearchName,
} from "./savedSearch.service.js";

function mapSavedSearchRow(row: SavedSearch) {
  return {
    id: row.id,
    name: row.name,
    query: row.query,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    alertEnabled: row.alertEnabled,
    alertThreshold: row.alertThreshold,
    alertLastSentAt: row.alertLastSentAt?.toISOString() ?? null,
    alertJobsSeen: row.alertJobsSeen,
  };
}

export function registerSavedSearchRoutes(server: FastifyInstance): void {
  server.get("/saved-searches/alert-status", async (request, reply) => {
    const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
    if (!ctx) {
      return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    }

    const rows = await server.prisma.savedSearch.findMany({
      where: { userId: ctx.internalUserId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        alertEnabled: true,
        alertThreshold: true,
        alertLastSentAt: true,
      },
    });

    return reply.send({
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        alertEnabled: r.alertEnabled,
        alertThreshold: r.alertThreshold,
        alertLastSentAt: r.alertLastSentAt?.toISOString() ?? null,
      })),
    });
  });

  server.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    "/saved-searches/:id/unsubscribe",
    async (request, reply) => {
      const id = request.params.id;
      const token = typeof request.query?.token === "string" ? request.query.token : "";
      const secret = process.env.JOB_ALERT_HMAC_SECRET?.trim();
      if (!secret) {
        return reply.status(503).type("text/html").send("<p>Alerts are not configured.</p>");
      }

      const row = await server.prisma.savedSearch.findUnique({
        where: { id },
        include: { user: { select: { id: true } } },
      });
      if (!row) {
        return reply.status(404).type("text/html").send("<p>Search not found.</p>");
      }

      const ok = verifyJobAlertUnsubscribeToken(row.userId, id, secret, token);
      if (!ok) {
        return reply.status(403).type("text/html").send("<p>Invalid unsubscribe link.</p>");
      }

      await server.prisma.savedSearch.update({
        where: { id },
        data: { alertEnabled: false },
      });

      const label = row.name?.trim() || "this search";
      return reply
        .type("text/html")
        .send(
          `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Unsubscribed</title></head><body style="font-family:system-ui;padding:2rem;max-width:520px;margin:0 auto;">` +
            `<p>You&apos;ve been unsubscribed from job alerts for &ldquo;${escapeHtml(label)}&rdquo;.</p>` +
            `<p><a href="/jobs">Back to jobs</a></p></body></html>`,
        );
    },
  );

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
        data: mapSavedSearchRow(existing),
      });
    }

    const { plan } = await resolveProPlan(server.prisma, ctx.internalUserId, ctx.email);
    const searchLimit = getPlanLimits(plan).savedSearches;
    if (searchLimit === 0) {
      return reply.status(403).send({
        error: "Saved searches require Pro",
        code: "PRO_REQUIRED",
      });
    }

    const count = await getUserSavedSearchCount(server.prisma, ctx.internalUserId);
    if (count >= searchLimit) {
      return reply
        .status(409)
        .send({ error: "Saved search limit reached", code: "SAVED_SEARCH_LIMIT_REACHED" });
    }

    const name =
      rawName ||
      (await resolveDefaultSavedSearchName(server.prisma, ctx.internalUserId));

    const created = await server.prisma.savedSearch.create({
      data: {
        userId: ctx.internalUserId,
        name,
        query,
      },
    });

    return reply.status(201).send({
      data: mapSavedSearchRow(created),
    });
  });

  server.get("/saved-searches", async (request, reply) => {
    const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
    if (!ctx) {
      return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    }

    const { plan } = await resolveProPlan(server.prisma, ctx.internalUserId, ctx.email);
    const limit = getPlanLimits(plan).savedSearches;

    const rows = await server.prisma.savedSearch.findMany({
      where: { userId: ctx.internalUserId },
      orderBy: { createdAt: "desc" },
    });

    return reply.send({
      data: rows.map(mapSavedSearchRow),
      meta: { count: rows.length, limit },
    });
  });

  server.patch<{
    Params: { id: string };
    Body: { enabled?: boolean; threshold?: number };
  }>("/saved-searches/:id/alert", async (request, reply) => {
    const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
    if (!ctx) {
      return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    }

    const pro = await isUserPro(server.prisma, ctx.internalUserId, ctx.email);
    if (!pro) {
      return reply.status(403).send({
        error: "Pro subscription required",
        code: "PRO_REQUIRED",
      });
    }

    const id = request.params.id;
    const enabled = request.body?.enabled;
    const thresholdRaw = request.body?.threshold;

    if (typeof enabled !== "boolean") {
      return reply.status(400).send({ error: "enabled is required", code: "INVALID_BODY" });
    }

    let threshold = 5;
    if (thresholdRaw !== undefined) {
      if (thresholdRaw !== 5 && thresholdRaw !== 10) {
        return reply.status(400).send({ error: "threshold must be 5 or 10", code: "INVALID_BODY" });
      }
      threshold = thresholdRaw;
    }

    const result = await server.prisma.savedSearch.updateMany({
      where: { id, userId: ctx.internalUserId },
      data: {
        alertEnabled: enabled,
        alertThreshold: threshold,
      },
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

    return reply.send({ data: mapSavedSearchRow(row) });
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
        data: mapSavedSearchRow(row),
      });
    },
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
