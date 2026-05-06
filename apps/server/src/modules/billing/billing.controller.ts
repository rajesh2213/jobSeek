import type { FastifyInstance } from "fastify";
import paypalhttp from "@paypal/paypalhttp";
import { resolveClerkUser } from "../../infrastructure/auth/clerkVerify.js";
import {
  cancelPayPalSubscription,
  createPayPalHttpClient,
  fetchPayPalSubscriptionDetails,
  getPayPalPlanId,
  resolvePayPalSubscriptionCheckoutUrls,
  verifyPayPalWebhook,
  type BillingPlanType,
} from "./paypal.client.js";
import { resolveProPlan } from "../../utils/userPlan.js";
import { applyPayPalSubscriptionEvent, statusFromPayPalEvent } from "./billing.service.js";
import { cancelDodoSubscription } from "./dodo.client.js";

type PayPalSubscriptionCreateBody = {
  planType?: BillingPlanType;
};
type BillingCancelBody = { reason?: string };

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
          server.log.warn({
            event: "billing_webhook_event_ignored",
            provider: "paypal",
            eventType,
            eventId,
          });
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

  server.post<{ Params: { subscriptionId: string }; Querystring: { force?: string } }>(
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
        const force = request.query.force === "true";
        server.log.info({
          event: "paypal_reconcile_fetched_provider_state",
          subscriptionId: details.id,
          userId,
          force,
          providerStatus: details.status,
          providerCurrentPeriodEnd: details.nextBillingTime?.toISOString() ?? null,
        });
        const existing = await server.prisma.subscription.findUnique({
          where: { userId },
          select: { status: true, lastEventAt: true, lastEventType: true },
        });
        if (existing?.lastEventAt && !force) {
          server.log.warn(
            {
              event: "paypal_reconcile_requires_force",
              subscriptionId,
              userId,
              existingStatus: existing.status,
              existingLastEventAt: existing.lastEventAt.toISOString(),
              existingLastEventType: existing.lastEventType,
            },
            "PayPal reconcile blocked because existing subscription has newer or unknown state; pass ?force=true to override",
          );
          return reply.status(409).send({
            error: "Reconcile blocked to avoid overriding newer state. Re-run with force=true if needed.",
            code: "RECONCILE_REQUIRES_FORCE",
          });
        }

        const result = await applyPayPalSubscriptionEvent(server, {
          eventType: "INTERNAL.RECONCILE",
          eventAt: new Date(),
          paypalId: details.id,
          userId,
          status: mapPayPalSubscriptionStatus(details.status),
          currentPeriodEnd: details.nextBillingTime ?? new Date(),
          skipMonotonicCheck: force,
        });
        if (result.stale) {
          server.log.warn({
            event: "paypal_reconcile_skipped_stale",
            subscriptionId: details.id,
            userId,
            force,
          });
        }
        server.log.info({
          event: "paypal_reconcile_applied",
          subscriptionId: details.id,
          userId,
          force,
          applied: result.applied,
          stale: result.stale ?? false,
          status: details.status,
          currentPeriodEnd: (details.nextBillingTime ?? new Date()).toISOString(),
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

  server.post<{ Body: BillingCancelBody }>("/billing/cancel-subscription", async (request, reply) => {
    const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
    if (!ctx) {
      return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    }
    const subscription = await server.prisma.subscription.findUnique({
      where: { userId: ctx.internalUserId },
      select: {
        provider: true,
        paypalId: true,
        dodoSubscriptionId: true,
        status: true,
        currentPeriodEnd: true,
      },
    });
    if (!subscription) {
      return reply.status(404).send({ error: "Subscription not found", code: "SUBSCRIPTION_NOT_FOUND" });
    }
    const effectiveUntil = subscription.currentPeriodEnd.toISOString();
    const reason =
      request.body?.reason?.trim() || "Canceled by customer from JobLoom account settings.";
    if (subscription.status === "canceled") {
      return reply.send({ success: true, provider: subscription.provider, effectiveUntil, alreadyCanceled: true });
    }

    try {
      if (subscription.provider === "paypal") {
        const paypalId = subscription.paypalId?.trim();
        if (!paypalId) {
          return reply.status(409).send({ error: "PayPal subscription id missing", code: "MISSING_PROVIDER_ID" });
        }
        const providerResult = await cancelPayPalSubscription(paypalId, reason);
        server.log.info({
          event: "billing_cancel_requested",
          provider: "paypal",
          userId: ctx.internalUserId,
          paypalId,
          responseCode: providerResult.responseCode ?? null,
          dbStatus: subscription.status,
          effectiveUntil,
          providerStatus: providerResult.providerStatus ?? null,
          alreadyCanceled: providerResult.alreadyCanceled,
        });
        return reply.send({
          success: true,
          provider: "paypal",
          effectiveUntil,
          alreadyCanceled: providerResult.alreadyCanceled,
        });
      }

      const dodoId = subscription.dodoSubscriptionId?.trim();
      if (!dodoId) {
        return reply.status(409).send({ error: "Dodo subscription id missing", code: "MISSING_PROVIDER_ID" });
      }
      const providerResult = await cancelDodoSubscription(dodoId, reason);
      server.log.info({
        event: "billing_cancel_requested",
        provider: "dodo",
        userId: ctx.internalUserId,
        subscriptionId: dodoId,
        dbStatus: subscription.status,
        currentPeriodEnd: effectiveUntil,
        alreadyCanceled: providerResult.alreadyCanceled,
      });
      return reply.send({
        success: true,
        provider: "dodo",
        effectiveUntil,
        alreadyCanceled: providerResult.alreadyCanceled,
      });
    } catch (err) {
      server.log.error(
        { err, event: "billing_cancel_failed", userId: ctx.internalUserId, provider: subscription.provider },
        "Billing cancel-subscription failed",
      );
      return reply.status(502).send({ error: "Cancellation request failed", code: "CANCEL_FAILED" });
    }
  });

  server.get("/billing/status", async (request, reply) => {
    const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
    if (!ctx) {
      return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    }
    const { plan } = await resolveProPlan(server.prisma, ctx.internalUserId, ctx.email);
    const subscription = await server.prisma.subscription.findUnique({
      where: { userId: ctx.internalUserId },
      select: {
        provider: true,
        status: true,
        currentPeriodEnd: true,
        graceEndsAt: true,
      },
    });
    server.log.info({
      event: "billing_runtime_entitlement",
      userId: ctx.internalUserId,
      provider: subscription?.provider ?? null,
      status: subscription?.status ?? null,
      currentPeriodEnd: subscription?.currentPeriodEnd.toISOString() ?? null,
      graceEndsAt: subscription?.graceEndsAt?.toISOString() ?? null,
      entitlementResult: plan,
    });
    return reply.send({
      plan,
      subscription: subscription
        ? {
            provider: subscription.provider,
            status: subscription.status,
            currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
            graceEndsAt: subscription.graceEndsAt ? subscription.graceEndsAt.toISOString() : null,
          }
        : null,
    });
  });
}
