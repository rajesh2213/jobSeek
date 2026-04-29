import type { FastifyInstance } from "fastify";
import { batchTransactionOptionsDefault } from "../../infrastructure/db/prismaTransactionOptions.js";

export type BillingWebhookStatus = "active" | "canceled" | "past_due";
type EntitlementPlan = "pro" | "free";
type EntitlementSubscription = {
  status: string;
  currentPeriodEnd: Date;
  graceEndsAt: Date | null;
};

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
): Promise<{ applied: boolean }> {
  const now = new Date();
  return server.prisma.$transaction(
    async (tx) => {
      if (params.eventId) {
        const alreadyProcessed = await tx.processedWebhookEvent.findUnique({
          where: { eventId: params.eventId },
          select: { id: true },
        });
        if (alreadyProcessed) return { applied: false };
        await tx.processedWebhookEvent.create({
          data: { eventId: params.eventId },
        });
      }

      await tx.subscription.upsert({
        where: { paypalId: params.paypalId },
        update: {
          provider: "paypal",
          userId: params.userId,
          status: params.status,
          currentPeriodEnd: params.currentPeriodEnd,
          graceEndsAt: params.status === "past_due" ? pastDueGraceEnds(now) : null,
          lastEventAt: params.eventAt,
          lastEventType: params.eventType,
        },
        create: {
          userId: params.userId,
          provider: "paypal",
          paypalId: params.paypalId,
          status: params.status,
          currentPeriodEnd: params.currentPeriodEnd,
          graceEndsAt: params.status === "past_due" ? pastDueGraceEnds(now) : null,
          lastEventAt: params.eventAt,
          lastEventType: params.eventType,
        },
      });

      const subs = await tx.subscription.findMany({
        where: {
          userId: params.userId,
        },
        select: { status: true, currentPeriodEnd: true, graceEndsAt: true },
      });
      const plan = resolvePlanFromSubscriptions(subs, now);

      await tx.user.update({
        where: { id: params.userId },
        data: { plan },
      });
      return { applied: true };
    },
    { ...batchTransactionOptionsDefault },
  );
}
