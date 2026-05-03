import type { FastifyInstance } from "fastify";
import paypalhttp from "@paypal/paypalhttp";
import { resolveClerkUser } from "../../infrastructure/auth/clerkVerify.js";
import {
  createPayPalHttpClient,
  fetchPayPalSubscriptionDetails,
  getPayPalPlanId,
  resolvePayPalSubscriptionCheckoutUrls,
  verifyPayPalWebhook,
  type BillingPlanType,
} from "./paypal.client.js";
import { applyPayPalSubscriptionEvent, statusFromPayPalEvent } from "./billing.service.js";

type PayPalSubscriptionCreateBody = {
  planType?: BillingPlanType;
};

type PayPalSubscriptionLink = {
  rel?: string;
  href?: string;
};

type PayPalWebhookEvent = {
  id?: string;
  create_time?: string;
  event_type?: string;
  resource?: {
    id?: string;
    custom_id?: string;
    billing_info?: {
      next_billing_time?: string;
    };
  };
};

function parsePlanType(value: unknown): BillingPlanType | null {
  if (value === "monthly" || value === "yearly") return value;
  return null;
}

function nextPeriodEndFromEvent(event: PayPalWebhookEvent): Date {
  const nextBillingTime = event.resource?.billing_info?.next_billing_time;
  if (typeof nextBillingTime === "string" && nextBillingTime.trim()) {
    const parsed = new Date(nextBillingTime);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function paypalHeaders(headers: Record<string, unknown>): Record<string, string | undefined> {
  const read = (name: string): string | undefined => {
    const value = headers[name] ?? headers[name.toLowerCase()];
    if (typeof value === "string") return value;
    return undefined;
  };
  return {
    "paypal-auth-algo": read("paypal-auth-algo"),
    "paypal-cert-url": read("paypal-cert-url"),
    "paypal-transmission-id": read("paypal-transmission-id"),
    "paypal-transmission-sig": read("paypal-transmission-sig"),
    "paypal-transmission-time": read("paypal-transmission-time"),
  };
}

function shouldVerboseLog(): boolean {
  return process.env.PAYPAL_BILLING_VERBOSE_LOGS?.trim() === "true";
}

function isInternalBillingAuthorized(authorizationHeader: unknown): boolean {
  const token = process.env.INTERNAL_METRICS_TOKEN?.trim();
  if (!token) {
    return process.env.NODE_ENV !== "production";
  }
  return authorizationHeader === `Bearer ${token}`;
}

function mapPayPalSubscriptionStatus(status: string): "active" | "canceled" | "past_due" {
  const normalized = status.trim().toUpperCase();
  if (normalized === "ACTIVE") return "active";
  if (normalized === "SUSPENDED") return "canceled";
  if (normalized === "CANCELLED") return "canceled";
  if (normalized === "EXPIRED") return "canceled";
  if (normalized === "APPROVAL_PENDING") return "past_due";
  return "past_due";
}

const billingMetrics = {
  "paypal.webhook.received": 0,
  "paypal.webhook.verified": 0,
  "paypal.webhook.failed_verification": 0,
  "paypal.subscription.activated": 0,
  "paypal.subscription.cancelled": 0,
  "paypal.subscription.suspended": 0,
  "paypal.subscription.failed": 0,
};

function incrementMetric(name: keyof typeof billingMetrics): number {
  billingMetrics[name] += 1;
  return billingMetrics[name];
}

/** Best-effort PayPal REST client error payload for logs (no response headers — may contain tokens). */
function paypalExecuteErrorSummary(err: unknown): Record<string, unknown> | undefined {
  if (!err || typeof err !== "object") return undefined;
  const o = err as Record<string, unknown>;
  const statusCode = o.statusCode;
  const message = typeof o.message === "string" ? o.message : undefined;
  let parsedBody: unknown;
  if (typeof message === "string") {
    try {
      parsedBody = JSON.parse(message) as unknown;
    } catch {
      parsedBody = undefined;
    }
  }
  const out: Record<string, unknown> = {};
  if (statusCode !== undefined) out.statusCode = statusCode;
  if (parsedBody !== undefined) out.details = parsedBody;
  else if (message !== undefined) out.message = message.slice(0, 500);
  return Object.keys(out).length ? out : undefined;
}

export function registerBillingRoutes(server: FastifyInstance): void {
  server.post(
    "/billing/paypal/webhook",
    {
      config: { rawBody: true },
    },
    async (request, reply) => {
      try {
        const raw = request.rawBody;
        if (!Buffer.isBuffer(raw)) {
          server.log.error({ hasRawBody: !!raw }, "PayPal webhook missing raw body");
          return reply.status(400).send({ error: "Invalid webhook body" });
        }
        let event: PayPalWebhookEvent;
        try {
          event = JSON.parse(raw.toString("utf8")) as PayPalWebhookEvent;
        } catch {
          return reply.status(400).send({ error: "Invalid JSON" });
        }

        const paypalId = event.resource?.id?.trim() ?? null;
        const userId = event.resource?.custom_id?.trim() ?? null;
        const eventId = event.id?.trim() ?? null;
        const eventType = event.event_type ?? "";
        incrementMetric("paypal.webhook.received");

        const verification = await verifyPayPalWebhook(
          paypalHeaders(request.headers as Record<string, unknown>),
          event,
        );
        server.log.info({
          msg: "paypal_webhook_received",
          eventId,
          eventType,
          paypalId,
          userId,
          verification_status: verification.verificationStatus,
        });
        if (!verification.verified) {
          incrementMetric("paypal.webhook.failed_verification");
          server.log.warn(
            {
              msg: "paypal_webhook_verification_failed",
              eventId,
              eventType,
              paypalId,
              userId,
              verification_status: verification.verificationStatus,
            },
            "PayPal webhook signature verification failed",
          );
          return reply.status(400).send({ error: "Invalid webhook signature" });
        }
        incrementMetric("paypal.webhook.verified");

        const normalizedStatus = statusFromPayPalEvent(eventType);
        if (!normalizedStatus) {
          return reply.send({ received: true, ignored: true });
        }

        if (!event.resource) {
          server.log.warn({ eventId, eventType }, "PayPal webhook missing resource");
          return reply.send({ received: true, ignored: true, reason: "MISSING_RESOURCE" });
        }
        if (!paypalId) {
          server.log.warn({ eventId, eventType, userId }, "PayPal webhook missing resource.id");
          return reply.send({ received: true, ignored: true, reason: "MISSING_PAYPAL_ID" });
        }
        if (!userId) {
          server.log.error({ eventId, eventType, paypalId }, "PayPal webhook missing custom_id");
          return reply.send({ received: true, ignored: true, reason: "MISSING_USER_ID" });
        }

        const user = await server.prisma.user.findUnique({
          where: { id: userId },
          select: { id: true },
        });
        if (!user) {
          server.log.error({ eventId, eventType, paypalId, userId }, "PayPal webhook user not found");
          return reply.send({ received: true, ignored: true, reason: "USER_NOT_FOUND" });
        }

        let periodEnd = nextPeriodEndFromEvent(event);
        if (
          eventType === "BILLING.SUBSCRIPTION.ACTIVATED" ||
          eventType === "BILLING.SUBSCRIPTION.RE-ACTIVATED"
        ) {
          const details = await fetchPayPalSubscriptionDetails(paypalId);
          if (details?.nextBillingTime) {
            periodEnd = details.nextBillingTime;
          }
        }

        const applied = await applyPayPalSubscriptionEvent(server, {
          eventId,
          eventType,
          eventAt:
            typeof event.create_time === "string" && !Number.isNaN(new Date(event.create_time).getTime())
              ? new Date(event.create_time)
              : new Date(),
          userId,
          paypalId,
          status: normalizedStatus,
          currentPeriodEnd: periodEnd,
        });
        if (!applied.applied) {
          return reply.send({ received: true, deduped: true });
        }
        if (eventType === "BILLING.SUBSCRIPTION.ACTIVATED" || eventType === "BILLING.SUBSCRIPTION.RE-ACTIVATED") {
          incrementMetric("paypal.subscription.activated");
        } else if (eventType === "BILLING.SUBSCRIPTION.CANCELLED") {
          incrementMetric("paypal.subscription.cancelled");
        } else if (eventType === "BILLING.SUBSCRIPTION.SUSPENDED") {
          incrementMetric("paypal.subscription.suspended");
        } else if (eventType === "BILLING.SUBSCRIPTION.PAYMENT.FAILED") {
          incrementMetric("paypal.subscription.failed");
        }
        if (shouldVerboseLog()) {
          server.log.info({
            msg: "paypal_webhook_applied",
            eventId,
            eventType,
            paypalId,
            userId,
            status: normalizedStatus,
          });
        }
      } catch (err) {
        const raw = request.rawBody;
        const event =
          Buffer.isBuffer(raw)
            ? (() => {
                try {
                  return JSON.parse(raw.toString("utf8")) as PayPalWebhookEvent;
                } catch {
                  return undefined;
                }
              })()
            : undefined;
        const payload =
          event && typeof event === "object"
            ? {
                id: event.id,
                event_type: event.event_type,
                resource: event.resource
                  ? { id: event.resource.id, custom_id: event.resource.custom_id }
                  : undefined,
              }
            : undefined;
        server.log.error({ err, payload }, "PayPal webhook handler error");
        return reply.status(500).send({ error: "Webhook handler failed" });
      }

      return reply.send({ received: true });
    },
  );

  server.post<{ Body: PayPalSubscriptionCreateBody }>(
    "/billing/paypal/create-subscription",
    async (request, reply) => {
      const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
      if (!ctx) {
        return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
      }
      if (!ctx.internalUserId?.trim()) {
        server.log.error({ clerkId: ctx.clerkId }, "Missing internal user id for PayPal subscription create");
        return reply.status(400).send({ error: "User mapping missing", code: "USER_MAPPING_MISSING" });
      }

      const planType = parsePlanType(request.body?.planType);
      if (!planType) {
        return reply.status(400).send({ error: "Invalid planType", code: "INVALID_PLAN_TYPE" });
      }

      try {
        const client = createPayPalHttpClient();
        const planId = getPayPalPlanId(planType);
        const { returnUrl, cancelUrl } = resolvePayPalSubscriptionCheckoutUrls();
        const payeePreferred =
          process.env.PAYPAL_PAYEE_PREFERRED?.trim().toUpperCase() === "IMMEDIATE_PAYMENT_REQUIRED"
            ? "IMMEDIATE_PAYMENT_REQUIRED"
            : "UNRESTRICTED";

        const createRequest = {
          plan_id: planId,
          custom_id: ctx.internalUserId.trim(),
          start_time: new Date(Date.now() + 120_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
          application_context: {
            brand_name: "JobLoom",
            locale: "en-US",
            user_action: "SUBSCRIBE_NOW",
            shipping_preference: "NO_SHIPPING",
            return_url: returnUrl,
            cancel_url: cancelUrl,
            payment_method: {
              payer_selected: "PAYPAL",
              payee_preferred: payeePreferred,
            },
          },
        };

        type CreateSubscriptionResponse = {
          links?: PayPalSubscriptionLink[];
        };

        const requestForClient: paypalhttp.HttpRequest = {
          path: "/v1/billing/subscriptions",
          verb: "POST",
          headers: { "content-type": "application/json" },
          body: createRequest,
        };

        const response = await client.execute(requestForClient);
        const result = response.result as CreateSubscriptionResponse & { id?: string };
        const approvalUrl = result.links?.find((link) => link.rel === "approve")?.href;

        if (result.id) {
          server.log.info(
            {
              event: "paypal_subscription_draft_created",
              paypalSubscriptionId: result.id,
              internalUserId: ctx.internalUserId,
              planType,
            },
            "paypal_subscription_draft_created",
          );
        }

        if (!approvalUrl) {
          server.log.error({ paypalResult: result }, "PayPal approval URL missing");
          return reply.status(502).send({ error: "Approval URL missing", code: "APPROVAL_URL_MISSING" });
        }

        return reply.send({ approvalUrl });
      } catch (err) {
        const paypalApi = paypalExecuteErrorSummary(err);
        server.log.error(
          { err, planType, paypalApi },
          "PayPal create-subscription failed",
        );
        const msg = err instanceof Error ? err.message : String(err);
        const configHint =
          msg.includes("PayPal checkout URLs missing") ||
          msg.includes("PAYPAL_RETURN_URL") ||
          msg.includes("must use https://");
        return reply.status(configHint ? 503 : 502).send({
          error: configHint ? "Billing checkout URL misconfigured on server" : "Checkout provider error",
          code: configHint ? "CHECKOUT_URL_CONFIG" : "CHECKOUT_FAILED",
        });
      }
    },
  );

  server.post<{ Params: { subscriptionId: string } }>(
    "/internal/paypal/reconcile/:subscriptionId",
    async (request, reply) => {
      if (!isInternalBillingAuthorized(request.headers.authorization)) {
        return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
      }
      const subscriptionId = request.params.subscriptionId?.trim();
      if (!subscriptionId) {
        return reply.status(400).send({ error: "Missing subscriptionId", code: "INVALID_SUBSCRIPTION_ID" });
      }

      try {
        const details = await fetchPayPalSubscriptionDetails(subscriptionId);
        if (!details) {
          return reply.status(404).send({ error: "Subscription not found in PayPal", code: "NOT_FOUND" });
        }
        const userId = details.customId?.trim();
        if (!userId) {
          return reply.status(400).send({ error: "Subscription missing custom_id", code: "MISSING_CUSTOM_ID" });
        }
        const user = await server.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
        if (!user) {
          return reply.status(404).send({ error: "User not found", code: "USER_NOT_FOUND" });
        }

        const result = await applyPayPalSubscriptionEvent(server, {
          eventType: "INTERNAL.RECONCILE",
          eventAt: new Date(),
          paypalId: details.id,
          userId,
          status: mapPayPalSubscriptionStatus(details.status),
          currentPeriodEnd: details.nextBillingTime ?? new Date(),
        });

        return reply.send({
          reconciled: true,
          applied: result.applied,
          subscriptionId: details.id,
          status: details.status,
          userId,
        });
      } catch (err) {
        server.log.error({ err, subscriptionId }, "PayPal internal reconcile failed");
        return reply.status(500).send({ error: "Reconcile failed", code: "RECONCILE_FAILED" });
      }
    },
  );
}
