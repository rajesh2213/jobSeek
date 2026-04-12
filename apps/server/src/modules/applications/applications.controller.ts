import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { resolveClerkUser } from "../../infrastructure/auth/clerkVerify.js";

export { isUserPro } from "../../utils/userPlan.js";

export const APPLICATION_STATUSES = [
  "applied",
  "acknowledged",
  "assessment",
  "interview",
  "offer",
  "rejected",
  "archived",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

const STATUS_SET = new Set<string>(APPLICATION_STATUSES);

const MS_DAY = 24 * 60 * 60 * 1000;
export const AUTO_ARCHIVE_DAYS = 30;
export const NEEDS_ACTION_DAYS = 14;

async function requireAuth(
  server: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ internalUserId: string } | null> {
  const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
  if (!ctx) {
    reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    return null;
  }
  return { internalUserId: ctx.internalUserId };
}

/** Auto-archive stale "applied" rows before listing. */
export async function runAutoArchiveOnRead(
  prisma: PrismaClient,
  userId: string,
): Promise<void> {
  const cutoff = new Date(Date.now() - AUTO_ARCHIVE_DAYS * MS_DAY);
  await prisma.application.updateMany({
    where: {
      userId,
      status: "applied",
      archived: false,
      appliedAt: { lt: cutoff },
      lastActivityAt: { lt: cutoff },
    },
    data: { archived: true },
  });
}

export function registerApplicationsController(server: FastifyInstance): void {
  server.get("/applications/stats", async (request, reply) => {
    const ctx = await requireAuth(server, request, reply);
    if (!ctx) return;

    const { internalUserId } = ctx;
    const needsActionCutoff = new Date(Date.now() - NEEDS_ACTION_DAYS * MS_DAY);

    const [total, grouped, needsAction] = await Promise.all([
      server.prisma.application.count({ where: { userId: internalUserId } }),
      server.prisma.application.groupBy({
        by: ["status"],
        where: { userId: internalUserId },
        _count: { _all: true },
      }),
      server.prisma.application.count({
        where: {
          userId: internalUserId,
          status: "applied",
          lastActivityAt: { lt: needsActionCutoff },
        },
      }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const g of grouped) {
      byStatus[g.status] = g._count._all;
    }

    return reply.send({
      total,
      byStatus,
      needsAction,
    });
  });

  server.get("/applications", async (request, reply) => {
    const ctx = await requireAuth(server, request, reply);
    if (!ctx) return;

    const { internalUserId } = ctx;
    await runAutoArchiveOnRead(server.prisma, internalUserId);

    const q = request.query as Record<string, string | undefined>;
    const statusFilter = q.status?.trim();
    const archivedRaw = q.archived;

    const where: {
      userId: string;
      status?: string;
      archived?: boolean;
    } = { userId: internalUserId };

    if (statusFilter && STATUS_SET.has(statusFilter)) {
      where.status = statusFilter;
    }
    if (archivedRaw === "true") {
      where.archived = true;
    } else if (archivedRaw === "false") {
      where.archived = false;
    }

    const rows = await server.prisma.application.findMany({
      where,
      orderBy: { lastActivityAt: "desc" },
      include: {
        job: {
          include: { company: true },
        },
      },
    });

    const data = rows.map((a) => ({
      id: a.id,
      status: a.status,
      appliedAt: a.appliedAt.toISOString(),
      lastActivityAt: a.lastActivityAt.toISOString(),
      archived: a.archived,
      notes: a.notes,
      job: {
        id: a.job.id,
        title: a.job.title,
        companyName: a.job.company.name,
        companyLogo: a.job.company.logoUrl,
        locationCountry: a.job.locationCountry,
        workType: a.job.workType,
        applyUrl: a.job.applyUrl ?? a.job.sourceUrl,
      },
    }));

    return reply.send(data);
  });

  server.post<{ Body: { jobId?: string } }>("/applications", async (request, reply) => {
    const ctx = await requireAuth(server, request, reply);
    if (!ctx) return;

    const jobId = typeof request.body?.jobId === "string" ? request.body.jobId.trim() : "";
    if (!jobId) {
      return reply.status(400).send({ error: "jobId is required", code: "INVALID_BODY" });
    }

    const job = await server.prisma.job.findUnique({
      where: { id: jobId },
      select: { id: true },
    });
    if (!job) {
      return reply.status(404).send({ error: "Job not found", code: "JOB_NOT_FOUND" });
    }

    const existing = await server.prisma.application.findUnique({
      where: {
        userId_jobId: { userId: ctx.internalUserId, jobId },
      },
    });

    if (existing) {
      return reply.send({
        id: existing.id,
        jobId,
        status: existing.status,
        appliedAt: existing.appliedAt.toISOString(),
        alreadyExisted: true,
      });
    }

    const created = await server.prisma.application.create({
      data: {
        userId: ctx.internalUserId,
        jobId,
        status: "applied",
        lastActivityAt: new Date(),
      },
    });

    return reply.status(201).send({
      id: created.id,
      jobId,
      status: created.status,
      appliedAt: created.appliedAt.toISOString(),
      alreadyExisted: false,
    });
  });

  server.patch<{
    Params: { id: string };
    Body: { status?: string };
  }>("/applications/:id/status", async (request, reply) => {
    const ctx = await requireAuth(server, request, reply);
    if (!ctx) return;

    const status = typeof request.body?.status === "string" ? request.body.status.trim() : "";
    if (!status || !STATUS_SET.has(status)) {
      return reply.status(400).send({ error: "Invalid status", code: "INVALID_STATUS" });
    }

    const id = request.params.id;
    const now = new Date();

    const result = await server.prisma.application.updateMany({
      where: { id, userId: ctx.internalUserId },
      data: { status, lastActivityAt: now },
    });

    if (result.count === 0) {
      return reply.status(404).send({ error: "Application not found", code: "NOT_FOUND" });
    }

    return reply.send({ success: true, status, lastActivityAt: now.toISOString() });
  });

  server.patch<{
    Params: { id: string };
    Body: { notes?: string | null };
  }>("/applications/:id/notes", async (request, reply) => {
    const ctx = await requireAuth(server, request, reply);
    if (!ctx) return;

    const raw = request.body?.notes;
    const notes = raw === null || raw === undefined ? null : String(raw);

    const id = request.params.id;

    const result = await server.prisma.application.updateMany({
      where: { id, userId: ctx.internalUserId },
      data: { notes },
    });

    if (result.count === 0) {
      return reply.status(404).send({ error: "Application not found", code: "NOT_FOUND" });
    }

    return reply.send({ success: true });
  });

  server.delete<{ Params: { id: string } }>("/applications/:id", async (request, reply) => {
    const ctx = await requireAuth(server, request, reply);
    if (!ctx) return;

    const id = request.params.id;
    const result = await server.prisma.application.deleteMany({
      where: { id, userId: ctx.internalUserId },
    });

    if (result.count === 0) {
      return reply.status(404).send({ error: "Application not found", code: "NOT_FOUND" });
    }

    return reply.send({ success: true });
  });
}
