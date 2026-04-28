import type { FastifyInstance } from "fastify";
import { resolveClerkUser } from "../../infrastructure/auth/clerkVerify.js";
import { ensureEmailPreference, enqueueGrowthEmailEvent } from "./growthEmail.service.js";
import { verifyGrowthEmailUnsubscribeToken } from "../../utils/growthEmailToken.js";

type SubscribeBody = {
  email?: string;
  source?: string;
  context?: { role?: string; location?: string; jobId?: string };
};

const ALLOWED_SOURCES = new Set(["homepage", "job_page", "jobs_listing", "exit_intent", "extension"]);

function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

function isValidEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
}

function asSource(raw: unknown): string {
  if (typeof raw !== "string") return "homepage";
  const value = raw.trim().toLowerCase();
  return ALLOWED_SOURCES.has(value) ? value : "homepage";
}

export function registerGrowthEmailRoutes(server: FastifyInstance): void {
  server.post<{ Body: SubscribeBody }>("/email/subscribe", async (request, reply) => {
    const source = asSource(request.body?.source);
    const emailRaw = typeof request.body?.email === "string" ? normalizeEmail(request.body.email) : "";
    if (!emailRaw || !isValidEmail(emailRaw)) {
      return reply.status(400).send({ error: "Invalid email", code: "INVALID_EMAIL" });
    }

    const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
    if (ctx) {
      await ensureEmailPreference(server.prisma, {
        userId: ctx.internalUserId,
        source,
        markActive: true,
      });
      await enqueueGrowthEmailEvent({
        userId: ctx.internalUserId,
        email: ctx.email ?? emailRaw,
        campaignType: "event_welcome",
        source,
      });
      return reply.send({ success: true, mode: "user" });
    }

    await server.prisma.emailLead.upsert({
      where: { email: emailRaw },
      create: {
        email: emailRaw,
        source,
        context: request.body?.context ? (request.body.context as object) : undefined,
      },
      update: {
        source,
        context: request.body?.context ? (request.body.context as object) : undefined,
      },
    });
    return reply.send({ success: true, mode: "lead" });
  });

  server.get("/growth-email/preferences", async (request, reply) => {
    const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
    if (!ctx) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    await ensureEmailPreference(server.prisma, {
      userId: ctx.internalUserId,
      source: "preferences_view",
      markActive: true,
    });
    const pref = await server.prisma.emailPreference.findUnique({
      where: { userId: ctx.internalUserId },
      select: {
        marketingEnabled: true,
        frequency: true,
        lastActiveAt: true,
        lastGrowthEmailSentAt: true,
      },
    });
    return reply.send({ data: pref });
  });

  server.patch<{
    Body: { marketingEnabled?: boolean; frequency?: "daily" | "weekly" | "off" };
  }>("/growth-email/preferences", async (request, reply) => {
    const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
    if (!ctx) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    const marketingEnabled =
      typeof request.body?.marketingEnabled === "boolean" ? request.body.marketingEnabled : undefined;
    const frequency = request.body?.frequency;
    if (frequency && !["daily", "weekly", "off"].includes(frequency)) {
      return reply.status(400).send({ error: "Invalid frequency", code: "INVALID_FREQUENCY" });
    }
    await ensureEmailPreference(server.prisma, {
      userId: ctx.internalUserId,
      source: "preferences_update",
      markActive: true,
    });
    const updated = await server.prisma.emailPreference.update({
      where: { userId: ctx.internalUserId },
      data: {
        ...(marketingEnabled !== undefined ? { marketingEnabled } : {}),
        ...(frequency ? { frequency } : {}),
      },
      select: {
        marketingEnabled: true,
        frequency: true,
        lastActiveAt: true,
        lastGrowthEmailSentAt: true,
      },
    });
    return reply.send({ data: updated });
  });

  server.get<{ Querystring: { token?: string } }>("/growth-email/unsubscribe", async (request, reply) => {
    const token = typeof request.query?.token === "string" ? request.query.token : "";
    const secret = process.env.JOB_ALERT_HMAC_SECRET?.trim();
    if (!secret) {
      return reply.status(503).type("text/html").send("<p>Email settings are not configured.</p>");
    }
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const userId = decoded.split(":")[0] ?? "";
    if (!userId || !verifyGrowthEmailUnsubscribeToken(userId, "growth_all", secret, token)) {
      return reply.status(403).type("text/html").send("<p>Invalid unsubscribe link.</p>");
    }
    await ensureEmailPreference(server.prisma, { userId, source: "unsubscribe_link" });
    await server.prisma.emailPreference.update({
      where: { userId },
      data: { marketingEnabled: false, frequency: "off" },
    });
    return reply
      .type("text/html")
      .send(
        "<!DOCTYPE html><html><head><meta charset='utf-8'/><title>Unsubscribed</title></head><body style='font-family:system-ui;padding:2rem;max-width:540px;margin:0 auto;'><p>You have been unsubscribed from growth emails.</p></body></html>",
      );
  });

  server.post<{ Body: { events?: Array<{ type?: string; email?: string }> } }>(
    "/email/provider/webhook",
    async (request, reply) => {
      const events = Array.isArray(request.body?.events) ? request.body.events : [];
      for (const event of events) {
        const email = typeof event.email === "string" ? normalizeEmail(event.email) : "";
        const type = typeof event.type === "string" ? event.type.toLowerCase() : "";
        if (!email) continue;
        if (!["bounce", "complaint", "unsubscribe"].includes(type)) continue;
        const user = await server.prisma.user.findUnique({
          where: { email },
          select: { id: true },
        });
        if (!user) continue;
        await ensureEmailPreference(server.prisma, { userId: user.id, source: `provider_${type}` });
        await server.prisma.emailPreference.update({
          where: { userId: user.id },
          data: { marketingEnabled: false, frequency: "off" },
        });
      }
      return reply.send({ success: true });
    },
  );
}
