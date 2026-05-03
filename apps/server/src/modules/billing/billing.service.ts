import type { FastifyInstance } from "fastify";
import { Prisma, type SubscriptionProvider } from "@prisma/client";
import { batchTransactionOptionsDefault } from "../../infrastructure/db/prismaTransactionOptions.js";

export type BillingWebhookStatus = "active" | "canceled" | "past_due";
type EntitlementPlan = "pro" | "free";
type EntitlementSubscription = {
  status: string;
  currentPeriodEnd: Date;
  graceEndsAt: Date | null;
};

export type ApplyBillingSubscriptionResult = { applied: boolean; stale?: boolean };

export function statusFromPayPalEvent(eventType: string): BillingWebhookStatus | null {
  switch (eventType) {
    case "BILLING.SUBSCRIPTION.ACTIVATED":
    case "BILLING.SUBSCRIPTION.RE-ACTIVATED":
      return "active";
    case "BILLING.SUBSCRIPTION.CANCELLED":
    case "BILLING.SUBSCRIPTION.SUSPENDED":
      return "canceled";
    case "BILLING.SUBSCRIPTION.PAYMENT.FAILED":
      return "past_due";
    default:
      return null;
  }
}

/** Dodo webhook `type` field (SDK uses British spelling for cancelled). */
export function statusFromDodoEvent(eventType: string): BillingWebhookStatus | null {
  switch (eventType) {
    case "payment.succeeded":
    case "subscription.active":
      return "active";
    case "payment.failed":
      return "past_due";
    case "subscription.canceled":
    case "subscription.cancelled":
      return "canceled";
    default:
      return null;
  }
}

export function resolvePlanFromSubscriptions(
  subscriptions: EntitlementSubscription[],
  now: Date,
): EntitlementPlan {
  for (const sub of subscriptions) {
    if (sub.status === "active") return "pro";
    if (sub.status === "canceled" && now < sub.currentPeriodEnd) return "pro";
    if (sub.status === "past_due" && sub.graceEndsAt && now < sub.graceEndsAt) return "pro";
  }
  return "free";
}

function pastDueGraceEnds(now: Date): Date {
  const graceDays = Number.parseInt(process.env.PAYPAL_PAST_DUE_GRACE_DAYS ?? "3", 10);
  const safeGraceDays = Number.isFinite(graceDays) && graceDays >= 0 ? graceDays : 3;
  return new Date(now.getTime() + safeGraceDays * 24 * 60 * 60 * 1000);
}

function resolveDedupeEventId(params: {
  provider: SubscriptionProvider;
  providerSubscriptionId: string;
  eventType: string;
  eventAt: Date;
  explicitEventId?: string | null;
  /** ISO-8601 from provider payload for synthetic id (never Date.now()). */
  providerTimestampIso?: string | null;
}): string | null {
  const trimmed = params.explicitEventId?.trim();
  if (trimmed) return trimmed;
  const iso =
    params.providerTimestampIso?.trim() && !Number.isNaN(Date.parse(params.providerTimestampIso))
      ? new Date(params.providerTimestampIso).toISOString()
      : params.eventAt.toISOString();
  return `${params.provider}:${params.providerSubscriptionId}:${params.eventType}:${iso}`;
}

/**
 * Shared transactional apply for PayPal and Dodo. One `Subscription` row per `userId`.
 * When `explicitEventId` is null/undefined and `skipProcessedWebhook` is true, skips ProcessedWebhookEvent (internal reconcile).
 */
export async function applyBillingSubscriptionWebhookEvent(
  server: FastifyInstance,
  params: {
    provider: SubscriptionProvider;
    providerSubscriptionId: string;
    userId: string;
    status: BillingWebhookStatus;
    currentPeriodEnd: Date;
    eventType: string;
    eventAt: Date;
    /** PayPal `event.id` or Dodo `webhook-id` header — preferred for dedupe. */
    explicitEventId?: string | null;
    /** For synthetic dedupe id only — ISO string from provider payload. */
    providerTimestampIso?: string | null;
    /** Internal jobs: do not record ProcessedWebhookEvent or require dedupe id. */
    skipProcessedWebhook?: boolean;
  },
): Promise<ApplyBillingSubscriptionResult> {
  const now = new Date();
  const dedupeId = params.skipProcessedWebhook
    ? null
    : resolveDedupeEventId({
        provider: params.provider,
        providerSubscriptionId: params.providerSubscriptionId,
        eventType: params.eventType,
        eventAt: params.eventAt,
        explicitEventId: params.explicitEventId,
        providerTimestampIso: params.providerTimestampIso,
      });

  const skipMonotonic = params.skipProcessedWebhook || params.eventType.startsWith("INTERNAL.");

  const paypalId = params.provider === "paypal" ? params.providerSubscriptionId : null;
  const dodoSubscriptionId = params.provider === "dodo" ? params.providerSubscriptionId : null;

  return server.prisma.$transaction(
    async (tx) => {
      if (dedupeId) {
        const alreadyProcessed = await tx.processedWebhookEvent.findUnique({
          where: { eventId: dedupeId },
          select: { id: true },
        });
        if (alreadyProcessed) return { applied: false };

        await tx.processedWebhookEvent.create({
          data: { eventId: dedupeId },
        });
      }

      const existing = await tx.subscription.findUnique({
        where: { userId: params.userId },
      });

      if (
        !skipMonotonic &&
        existing?.lastEventAt &&
        params.eventAt.getTime() < existing.lastEventAt.getTime()
      ) {
        return { applied: false, stale: true };
      }

      const subscriptionData = {
        provider: params.provider,
        paypalId,
        dodoSubscriptionId,
        status: params.status,
        currentPeriodEnd: params.currentPeriodEnd,
        graceEndsAt: params.status === "past_due" ? pastDueGraceEnds(now) : null,
        lastEventAt: params.eventAt,
        lastEventType: params.eventType,
      };

      if (existing) {
        await tx.subscription.update({
          where: { userId: params.userId },
          data: subscriptionData,
        });
      } else {
        await tx.subscription.create({
          data: {
            userId: params.userId,
            ...subscriptionData,
          },
        });
      }

      const subs = await tx.subscription.findMany({
        where: { userId: params.userId },
        select: { status: true, currentPeriodEnd: true, graceEndsAt: true },
      });
      const plan = resolvePlanFromSubscriptions(subs, now);

      await tx.user.update({
        where: { id: params.userId },
        data: { plan },
      });
      return { applied: true };
    },
    {
      ...batchTransactionOptionsDefault,
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}

export async function applyPayPalSubscriptionEvent(
  server: FastifyInstance,
  params: {
    eventId?: string | null;
    eventType: string;
    eventAt: Date;
    paypalId: string;
    userId: string;
    status: BillingWebhookStatus;
    currentPeriodEnd: Date;
  },
): Promise<ApplyBillingSubscriptionResult> {
  return applyBillingSubscriptionWebhookEvent(server, {
    provider: "paypal",
    providerSubscriptionId: params.paypalId,
    userId: params.userId,
    status: params.status,
    currentPeriodEnd: params.currentPeriodEnd,
    eventType: params.eventType,
    eventAt: params.eventAt,
    explicitEventId: params.eventId,
    providerTimestampIso: params.eventAt.toISOString(),
    skipProcessedWebhook: params.eventType.startsWith("INTERNAL."),
  });
}

export async function applyDodoSubscriptionEvent(
  server: FastifyInstance,
  params: {
    eventId?: string | null;
    providerTimestampIso?: string | null;
    eventType: string;
    eventAt: Date;
    dodoSubscriptionId: string;
    userId: string;
    status: BillingWebhookStatus;
    currentPeriodEnd: Date;
  },
): Promise<ApplyBillingSubscriptionResult> {
  return applyBillingSubscriptionWebhookEvent(server, {
    provider: "dodo",
    providerSubscriptionId: params.dodoSubscriptionId,
    userId: params.userId,
    status: params.status,
    currentPeriodEnd: params.currentPeriodEnd,
    eventType: params.eventType,
    eventAt: params.eventAt,
    explicitEventId: params.eventId,
    providerTimestampIso: params.providerTimestampIso ?? null,
    skipProcessedWebhook: false,
  });
}
