import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createCheckout, lemonSqueezySetup } from "@lemonsqueezy/lemonsqueezy.js";
import { resolveClerkUser } from "../../infrastructure/auth/clerkVerify.js";

type LsWebhookPayload = {
  meta?: {
    event_name?: string;
    custom_data?: Record<string, string | number | boolean | null | undefined>;
  };
  data?: {
    type?: string;
    id?: string | number;
    attributes?: {
      store_id?: number;
      customer_id?: number;
      variant_id?: number;
      status?: string;
      renews_at?: string | null;
      ends_at?: string | null;
    };
  };
};

function ensureLemonSqueezy(): boolean {
  const apiKey = process.env.LEMONSQUEEZY_API_KEY?.trim();
  if (!apiKey) return false;
  lemonSqueezySetup({ apiKey });
  return true;
}

function allowedVariantIds(): Set<string> {
  const annual = process.env.LEMONSQUEEZY_PRO_ANNUAL_VARIANT_ID?.trim();
  const monthly = process.env.LEMONSQUEEZY_PRO_MONTHLY_VARIANT_ID?.trim();
  const set = new Set<string>();
  if (annual) set.add(annual);
  if (monthly) set.add(monthly);
  return set;
}

function mapLsSubscriptionStatus(lsStatus: string | undefined): string {
  switch (lsStatus) {
    case "on_trial":
    case "active":
    case "paused":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "cancelled":
    case "expired":
      return "canceled";
    default:
      return "active";
  }
}

function currentPeriodEndFromAttrs(attrs: NonNullable<LsWebhookPayload["data"]>["attributes"]): Date {
  if (!attrs) return new Date();
  if (attrs.ends_at) return new Date(attrs.ends_at);
  if (attrs.renews_at) return new Date(attrs.renews_at);
  return new Date();
}

function clerkIdFromMeta(meta: LsWebhookPayload["meta"]): string | null {
  const raw = meta?.custom_data?.clerk_id;
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}

function verifyLsSignature(secret: string, raw: Buffer, signatureHeader: string | undefined): boolean {
  if (typeof signatureHeader !== "string" || !signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const received = signatureHeader.trim();
  if (expected.length !== received.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(received, "utf8"));
  } catch {
    return false;
  }
}

async function upsertProSubscription(
  prisma: FastifyInstance["prisma"],
  params: {
    clerkId: string;
    lsSubscriptionId: string;
    customerId: string;
    variantId: string;
    status: string;
    currentPeriodEnd: Date;
  },
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { clerkId: params.clerkId } });
  if (!user) return;

  await prisma.$transaction([
    prisma.subscription.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        stripeCustomerId: params.customerId,
        stripePriceId: params.variantId,
        stripeSubscriptionId: params.lsSubscriptionId,
        status: params.status,
        currentPeriodEnd: params.currentPeriodEnd,
      },
      update: {
        stripeCustomerId: params.customerId,
        stripePriceId: params.variantId,
        stripeSubscriptionId: params.lsSubscriptionId,
        status: params.status,
        currentPeriodEnd: params.currentPeriodEnd,
      },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: { plan: "pro", stripeCustomerId: params.customerId },
    }),
  ]);
}

export function registerBillingRoutes(server: FastifyInstance): void {
  const lsKey = process.env.LEMONSQUEEZY_API_KEY?.trim();
  if (lsKey) {
    lemonSqueezySetup({ apiKey: lsKey });
  }

  server.post(
    "/billing/webhook",
    {
      config: { rawBody: true },
    },
    async (request, reply) => {
      const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET?.trim();
      if (!secret) {
        return reply.status(500).send({ error: "Webhook not configured" });
      }

      const raw = request.rawBody;
      if (!Buffer.isBuffer(raw)) {
        server.log.error("Lemon Squeezy webhook: rawBody missing or not a buffer");
        return reply.status(400).send({ error: "Invalid body" });
      }

      const sig = request.headers["x-signature"];
      if (!verifyLsSignature(secret, raw, typeof sig === "string" ? sig : undefined)) {
        server.log.warn("Lemon Squeezy webhook signature verification failed");
        return reply.status(400).send({ error: "Invalid signature" });
      }

      let payload: LsWebhookPayload;
      try {
        payload = JSON.parse(raw.toString("utf8")) as LsWebhookPayload;
      } catch {
        return reply.status(400).send({ error: "Invalid JSON" });
      }

      const eventName =
        (typeof request.headers["x-event-name"] === "string" && request.headers["x-event-name"]) ||
        payload.meta?.event_name ||
        "";

      try {
        switch (eventName) {
          case "order_created": {
            break;
          }
          case "subscription_created": {
            const attrs = payload.data?.attributes;
            const subId = payload.data?.id;
            if (!attrs || subId === undefined || subId === null) break;

            const clerkId = clerkIdFromMeta(payload.meta);
            if (!clerkId) {
              server.log.warn("subscription_created: missing meta.custom_data.clerk_id");
              break;
            }

            const lsSubscriptionId = String(subId);
            const customerId = String(attrs.customer_id ?? "");
            const variantId = String(attrs.variant_id ?? "");
            const status = mapLsSubscriptionStatus(attrs.status);
            const currentPeriodEnd = currentPeriodEndFromAttrs(attrs);

            await upsertProSubscription(server.prisma, {
              clerkId,
              lsSubscriptionId,
              customerId,
              variantId,
              status,
              currentPeriodEnd,
            });
            break;
          }
          case "subscription_updated": {
            const attrs = payload.data?.attributes;
            const subId = payload.data?.id;
            if (!attrs || subId === undefined || subId === null) break;

            const lsSubscriptionId = String(subId);
            const status = mapLsSubscriptionStatus(attrs.status);
            const currentPeriodEnd = currentPeriodEndFromAttrs(attrs);
            const variantId = String(attrs.variant_id ?? "");
            const customerId = String(attrs.customer_id ?? "");

            const existing = await server.prisma.subscription.findUnique({
              where: { stripeSubscriptionId: lsSubscriptionId },
            });

            if (existing) {
              await server.prisma.subscription.update({
                where: { stripeSubscriptionId: lsSubscriptionId },
                data: {
                  status,
                  currentPeriodEnd,
                  ...(variantId ? { stripePriceId: variantId } : {}),
                  ...(customerId ? { stripeCustomerId: customerId } : {}),
                },
              });
              break;
            }

            const clerkId = clerkIdFromMeta(payload.meta);
            if (!clerkId) break;

            await upsertProSubscription(server.prisma, {
              clerkId,
              lsSubscriptionId,
              customerId,
              variantId,
              status,
              currentPeriodEnd,
            });
            break;
          }
          case "subscription_cancelled": {
            const subId = payload.data?.id;
            if (subId === undefined || subId === null) break;

            const lsSubscriptionId = String(subId);
            const row = await server.prisma.subscription.findUnique({
              where: { stripeSubscriptionId: lsSubscriptionId },
            });
            if (!row) break;

            await server.prisma.$transaction([
              server.prisma.user.update({
                where: { id: row.userId },
                data: { plan: "free" },
              }),
              server.prisma.subscription.update({
                where: { id: row.id },
                data: { status: "canceled" },
              }),
            ]);
            break;
          }
          default:
            break;
        }
      } catch (err) {
        server.log.error({ err, eventName }, "Lemon Squeezy webhook handler error");
        return reply.status(500).send({ error: "Webhook handler failed" });
      }

      return reply.send({ received: true });
    },
  );

  server.post<{ Body: { variantId?: string } }>("/billing/create-checkout", async (request, reply) => {
    const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
    if (!ctx) {
      return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    }

    const variantIdRaw =
      typeof request.body?.variantId === "string" ? request.body.variantId.trim() : "";
    const allowed = allowedVariantIds();
    if (!variantIdRaw || allowed.size === 0 || !allowed.has(variantIdRaw)) {
      return reply.status(400).send({ error: "Invalid variantId", code: "INVALID_VARIANT" });
    }

    const clientUrl =
      process.env.CLIENT_URL?.trim() ||
      process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
      "";
    if (!clientUrl) {
      return reply.status(500).send({
        error: "CLIENT_URL or NEXT_PUBLIC_SITE_URL is required for checkout redirects",
        code: "MISSING_CLIENT_URL",
      });
    }
    const base = clientUrl.replace(/\/$/, "");

    const storeIdRaw = process.env.LEMONSQUEEZY_STORE_ID?.trim();
    if (!storeIdRaw) {
      return reply.status(503).send({ error: "Billing not configured", code: "BILLING_DISABLED" });
    }

    if (!ensureLemonSqueezy()) {
      return reply.status(503).send({ error: "Billing not configured", code: "BILLING_DISABLED" });
    }

    const user = await server.prisma.user.findUnique({ where: { id: ctx.internalUserId } });
    if (!user) {
      return reply.status(404).send({ error: "User not found", code: "USER_NOT_FOUND" });
    }

    const emailForCheckout =
      ctx.email?.includes("@") && !ctx.email.endsWith("@users.clerk.local")
        ? ctx.email
        : user.email;

    const variantNum = Number.parseInt(variantIdRaw, 10);
    const enabledVariants = Number.isFinite(variantNum) ? [variantNum] : undefined;

    const { data, error } = await createCheckout(storeIdRaw, variantIdRaw, {
      checkoutData: {
        email: emailForCheckout,
        custom: { clerk_id: ctx.clerkId },
      },
      productOptions: {
        ...(enabledVariants ? { enabledVariants } : {}),
        redirectUrl: `${base}/account?upgraded=true`,
      },
      checkoutOptions: {
        discount: true,
      },
    });

    if (error) {
      server.log.error({ err: error }, "Lemon Squeezy createCheckout failed");
      return reply.status(502).send({ error: "Checkout provider error", code: "CHECKOUT_FAILED" });
    }

    const url = data?.data?.attributes?.url;
    if (!url) {
      return reply.status(500).send({ error: "Checkout URL missing", code: "CHECKOUT_URL" });
    }

    return reply.send({ url });
  });
}
