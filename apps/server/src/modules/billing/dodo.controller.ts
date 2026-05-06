import type { FastifyInstance } from "fastify";
import { resolveClerkUser } from "../../infrastructure/auth/clerkVerify.js";
import {
  applyDodoSubscriptionEvent,
  hasActiveEntitlement,
  statusFromDodoEvent,
} from "./billing.service.js";
import {
  createDodoCheckoutSession,
  fetchDodoSubscriptionPeriodEnd,
  verifyAndParseDodoWebhook,
  type DodoBillingPlanType,
  type UnwrapWebhookEvent,
} from "./dodo.client.js";

type DodoCreateBody = { planType?: DodoBillingPlanType };

function readHeader(headers: Record<string, unknown>, name: string): string | undefined {
  const direct = headers[name];
  if (typeof direct === "string" && direct) return direct;
  const lower = headers[name.toLowerCase()];
  if (typeof lower === "string" && lower) return lower;
  return undefined;
}

function parsePlanType(value: unknown): DodoBillingPlanType | null {
  if (value === "monthly" || value === "yearly") return value;
  return null;
}

function extractDodoSubscriptionId(event: UnwrapWebhookEvent): string | null {
  switch (event.type) {
    case "payment.succeeded":
    case "payment.failed":
      return event.data.subscription_id?.trim() || null;
    case "subscription.active":
    case "subscription.cancelled":
      return event.data.subscription_id?.trim() || null;
    default:
      return null;
  }
}

/** Session-level metadata often does not appear on `subscription.data.metadata` in webhooks; check payment/subscription metadata and `customer.metadata`. */
function extractDodoUserId(event: UnwrapWebhookEvent): string | null {
  switch (event.type) {
    case "payment.succeeded":
    case "payment.failed":
      return (
        event.data.metadata?.userId?.trim() ||
        event.data.customer?.metadata?.userId?.trim() ||
        null
      );
    case "subscription.active":
    case "subscription.cancelled":
      return (
        event.data.metadata?.userId?.trim() ||
        event.data.customer?.metadata?.userId?.trim() ||
        null
      );
    default:
      return null;
  }
}

function dodoCustomerEmailFromEvent(event: UnwrapWebhookEvent): string | null {
  switch (event.type) {
    case "payment.succeeded":
    case "payment.failed":
    case "subscription.active":
    case "subscription.cancelled": {
      const email = event.data.customer?.email?.trim();
      return email || null;
    }
    default:
      return null;
  }
}

async function resolveDodoWebhookInternalUserId(
  server: FastifyInstance,
  event: UnwrapWebhookEvent,
): Promise<{ userId: string; viaEmailFallback: boolean } | null> {
  const fromPayload = extractDodoUserId(event);
  if (fromPayload) return { userId: fromPayload, viaEmailFallback: false };

  const email = dodoCustomerEmailFromEvent(event);
  if (!email) return null;

  const user = await server.prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  if (!user) return null;
  return { userId: user.id, viaEmailFallback: true };
}

function subscriptionPeriodEndFromDodoEvent(event: UnwrapWebhookEvent): Date | null {
  if (event.type === "subscription.active" || event.type === "subscription.cancelled") {
    const raw = event.data.next_billing_date?.trim();
    if (raw) {
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  return null;
}

export function pickDodoCurrentPeriodEnd(params: {
  eventPeriodEnd: Date | null;
  existingPeriodEnd: Date | null;
  providerPeriodEnd: Date | null;
  now: Date;
}): {
  currentPeriodEnd: Date;
  fallbackSourceUsed: "event.next_billing_date" | "db.currentPeriodEnd" | "provider.fetch" | "now";
} {
  if (params.eventPeriodEnd) {
    return {
      currentPeriodEnd: params.eventPeriodEnd,
      fallbackSourceUsed: "event.next_billing_date",
    };
  }
  if (params.existingPeriodEnd && params.existingPeriodEnd.getTime() > params.now.getTime()) {
    return {
      currentPeriodEnd: params.existingPeriodEnd,
      fallbackSourceUsed: "db.currentPeriodEnd",
    };
  }
  if (params.providerPeriodEnd && params.providerPeriodEnd.getTime() > params.now.getTime()) {
    return {
      currentPeriodEnd: params.providerPeriodEnd,
      fallbackSourceUsed: "provider.fetch",
    };
  }
  return {
    currentPeriodEnd: params.now,
    fallbackSourceUsed: "now",
  };
}

function resolveDodoDedupeEventId(
  headers: Record<string, unknown>,
  event: UnwrapWebhookEvent,
  subscriptionId: string,
): string {
  const webhookId = readHeader(headers, "webhook-id")?.trim();
  if (webhookId) return webhookId;
  return `dodo:${subscriptionId}:${event.type}:${event.timestamp}`;
}

const dodoMetrics = {
  "dodo.webhook.received": 0,
  "dodo.webhook.verified": 0,
  "dodo.webhook.failed_verification": 0,
  "dodo.webhook.applied": 0,
  "dodo.webhook.stale_skipped": 0,
};

function incrementDodoMetric(name: keyof typeof dodoMetrics): void {
  dodoMetrics[name] += 1;
}

async function assertAllowedDodoCheckout(
  server: FastifyInstance,
  userId: string,
): Promise<{ ok: true } | { ok: false; code: string }> {
  const row = await server.prisma.user.findUnique({
    where: { id: userId },
    include: { subscription: true },
  });
  if (!row) return { ok: false, code: "USER_NOT_FOUND" };

  const proByPlan = row.plan === "pro" || row.plan === "pro_plus";
  const entitledBySubscription = hasActiveEntitlement(row.subscription, new Date());
  const pastDue = row.subscription?.status === "past_due";

  if ((proByPlan || entitledBySubscription) && !pastDue) {
    return { ok: false, code: "ALREADY_PRO" };
  }
  return { ok: true };
}

export function registerDodoBillingRoutes(server: FastifyInstance): void {
  server.post<{ Body: DodoCreateBody }>(
    "/billing/dodo/create-checkout",
    async (request, reply) => {
      const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
      if (!ctx) {
        return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
      }
      if (!ctx.internalUserId?.trim()) {
        server.log.error({ clerkId: ctx.clerkId }, "Missing internal user id for Dodo checkout");
        return reply.status(400).send({ error: "User mapping missing", code: "USER_MAPPING_MISSING" });
      }

      const planType = parsePlanType(request.body?.planType);
      if (!planType) {
        return reply.status(400).send({ error: "Invalid planType", code: "INVALID_PLAN_TYPE" });
      }

      const allowed = await assertAllowedDodoCheckout(server, ctx.internalUserId.trim());
      if (!allowed.ok) {
        if (allowed.code === "USER_NOT_FOUND") {
          return reply.status(404).send({ error: "User not found", code: "USER_NOT_FOUND" });
        }
        return reply.status(409).send({
          error: "You already have an active Pro subscription.",
          code: allowed.code,
        });
      }

      const email = ctx.email?.trim();
      if (!email) {
        return reply.status(400).send({ error: "Email required for checkout", code: "EMAIL_REQUIRED" });
      }

      try {
        const { checkoutUrl } = await createDodoCheckoutSession({
          planType,
          userId: ctx.internalUserId.trim(),
          customerEmail: email,
        });
        return reply.send({ checkoutUrl });
      } catch (err) {
        server.log.error({ err, planType }, "Dodo create-checkout failed");
        const msg = err instanceof Error ? err.message : String(err);
        const configHint =
          msg.includes("not configured") ||
          msg.includes("return URL missing") ||
          msg.includes("DODO_PRODUCT_ID");
        return reply.status(configHint ? 503 : 502).send({
          error: configHint ? "Billing is not configured on the server" : "Checkout provider error",
          code: configHint ? "BILLING_CONFIG" : "CHECKOUT_FAILED",
        });
      }
    },
  );

  server.post(
    "/billing/dodo/webhook",
    {
      config: { rawBody: true },
    },
    async (request, reply) => {
      const raw = request.rawBody;
      if (!Buffer.isBuffer(raw)) {
        server.log.error({ hasRawBody: !!raw }, "Dodo webhook missing raw body");
        return reply.status(400).send({ error: "Invalid webhook body" });
      }

      const rawUtf8 = raw.toString("utf8");
      incrementDodoMetric("dodo.webhook.received");

      let event: UnwrapWebhookEvent;
      try {
        event = verifyAndParseDodoWebhook(rawUtf8, request.headers as Record<string, unknown>);
      } catch (err) {
        incrementDodoMetric("dodo.webhook.failed_verification");
        server.log.warn({ err }, "Dodo webhook signature verification failed");
        return reply.status(400).send({ error: "Invalid webhook signature" });
      }

      incrementDodoMetric("dodo.webhook.verified");

      const eventType = event.type;
      const normalizedStatus = statusFromDodoEvent(eventType);
      if (!normalizedStatus) {
        server.log.warn({
          event: "billing_webhook_event_ignored",
          provider: "dodo",
          eventType,
          eventId: readHeader(request.headers as Record<string, unknown>, "webhook-id") ?? null,
        });
        return reply.send({ received: true, ignored: true });
      }

      const resolvedUser = await resolveDodoWebhookInternalUserId(server, event);
      if (!resolvedUser) {
        server.log.error(
          { eventType },
          "Dodo webhook could not resolve JobLoom user (no metadata.userId / customer.metadata.userId and no matching customer email)",
        );
        return reply.status(400).send({
          error: "Cannot resolve user from webhook (metadata and email lookup failed)",
          code: "MISSING_USER_MAPPING",
        });
      }

      const { userId, viaEmailFallback } = resolvedUser;
      if (viaEmailFallback) {
        server.log.warn(
          { eventType, userId, email: dodoCustomerEmailFromEvent(event) },
          "Dodo webhook mapped user via customer.email (subscription/payment metadata had no userId)",
        );
      }

      const subscriptionId = extractDodoSubscriptionId(event);
      if (!subscriptionId) {
        server.log.warn({ eventType, userId }, "Dodo webhook missing subscription id");
        return reply.send({ received: true, ignored: true, reason: "MISSING_SUBSCRIPTION_ID" });
      }

      const user = await server.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      if (!user) {
        server.log.error({ eventType, userId, subscriptionId }, "Dodo webhook user not found");
        return reply.send({ received: true, ignored: true, reason: "USER_NOT_FOUND" });
      }

      const eventAt = new Date(event.timestamp);
      const eventAtSafe = Number.isNaN(eventAt.getTime()) ? new Date() : eventAt;
      const existing = await server.prisma.subscription.findUnique({
        where: { userId },
        select: { currentPeriodEnd: true },
      });
      const eventPeriodEnd = subscriptionPeriodEndFromDodoEvent(event);
      let providerPeriodEnd: Date | null = null;
      if (!eventPeriodEnd) {
        try {
          providerPeriodEnd = await fetchDodoSubscriptionPeriodEnd(subscriptionId);
        } catch {
          providerPeriodEnd = null;
        }
      }
      const selected = pickDodoCurrentPeriodEnd({
        eventPeriodEnd,
        existingPeriodEnd: existing?.currentPeriodEnd ?? null,
        providerPeriodEnd,
        now: new Date(),
      });
      const currentPeriodEnd = selected.currentPeriodEnd;
      if (selected.fallbackSourceUsed !== "event.next_billing_date") {
        server.log.warn({
          event: "dodo_period_end_fallback_used",
          provider: "dodo",
          eventType,
          userId,
          subscriptionId,
          fallbackSourceUsed: selected.fallbackSourceUsed,
        });
      }

      const dedupeId = resolveDodoDedupeEventId(request.headers as Record<string, unknown>, event, subscriptionId);

      try {
        const result = await applyDodoSubscriptionEvent(server, {
          eventId: dedupeId,
          providerTimestampIso: event.timestamp,
          eventType,
          eventAt: eventAtSafe,
          dodoSubscriptionId: subscriptionId,
          userId,
          status: normalizedStatus,
          currentPeriodEnd,
        });

        if (result.stale) {
          incrementDodoMetric("dodo.webhook.stale_skipped");
        } else if (result.applied) {
          incrementDodoMetric("dodo.webhook.applied");
        }

        if (result.applied === false && !result.stale) {
          return reply.send({ received: true, deduped: true });
        }
      } catch (err) {
        server.log.error({ err, eventType, subscriptionId, userId }, "Dodo webhook handler error");
        return reply.status(500).send({ error: "Webhook handler failed" });
      }

      return reply.send({ received: true });
    },
  );
}
