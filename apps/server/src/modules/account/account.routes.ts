import type { FastifyInstance } from "fastify";
import { resolveClerkUser } from "../../infrastructure/auth/clerkVerify.js";
import { registerAccountResumeRoutes } from "./account.controller.js";
import {
  ensureUserJobViewsDayReset,
  FREE_DAILY_JOB_VIEWS,
  nextUtcMidnight,
} from "../viewCap/viewCap.service.js";
import { resolveProPlan } from "../../utils/userPlan.js";

export function registerAccountRoutes(server: FastifyInstance): void {
  registerAccountResumeRoutes(server);
  server.get("/account/summary", async (request, reply) => {
    const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
    if (!ctx) {
      return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    }

    await ensureUserJobViewsDayReset(server.prisma, ctx.internalUserId);

    const row = await server.prisma.user.findUnique({
      where: { id: ctx.internalUserId },
    });
    if (!row) {
      return reply.status(404).send({ error: "User not found", code: "USER_NOT_FOUND" });
    }

    const { pro, plan } = await resolveProPlan(server.prisma, ctx.internalUserId, ctx.email);

    return reply.send({
      plan,
      jobViewsToday: row.jobViewsToday,
      jobViewsLimit: pro ? null : FREE_DAILY_JOB_VIEWS,
      resetAt: nextUtcMidnight().toISOString(),
    });
  });
}
