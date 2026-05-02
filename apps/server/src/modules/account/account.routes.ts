import type { FastifyInstance } from "fastify";
import {
  resolveClerkUserResult,
  sendClerkAuthFailureReply,
} from "../../infrastructure/auth/clerkVerify.js";
import { registerAccountResumeRoutes } from "./account.controller.js";
import { registerAccountApplyProfileRoutes } from "./account.applyProfile.js";
import {
  ensureUserJobViewsDayReset,
  nextUtcMidnight,
} from "../viewCap/viewCap.service.js";
import { resolveProPlan } from "../../utils/userPlan.js";
import { LIMITS } from "../../config/limits.js";

export function registerAccountRoutes(server: FastifyInstance): void {
  registerAccountResumeRoutes(server);
  registerAccountApplyProfileRoutes(server);
  server.get("/account/summary", async (request, reply) => {
    const auth = await resolveClerkUserResult(server.prisma, request.headers.authorization);
    if (!auth.ok) {
      return sendClerkAuthFailureReply(reply, auth.failure);
    }
    const ctx = auth.ctx;

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
      jobViewsLimit: pro ? null : LIMITS.FREE_TIER_DAILY_LIMIT,
      resetAt: nextUtcMidnight().toISOString(),
    });
  });
}
