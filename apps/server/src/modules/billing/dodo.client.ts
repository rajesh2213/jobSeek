import DodoPayments from "dodopayments";
import type { UnwrapWebhookEvent } from "dodopayments/resources/webhooks/webhooks.js";

export type { UnwrapWebhookEvent };

export type DodoBillingPlanType = "monthly" | "yearly";

export function getDodoEnvironment(): "test_mode" | "live_mode" {
  const raw = (process.env.DODO_PAYMENTS_ENVIRONMENT ?? process.env.DODO_PAYMENTS_MODE ?? "test")
    .trim()
    .toLowerCase();
  if (raw === "live" || raw === "live_mode") return "live_mode";
  return "test_mode";
}

export function getDodoProductId(planType: DodoBillingPlanType): string {
  const monthly = process.env.DODO_PRODUCT_ID_MONTHLY?.trim();
  const yearly = process.env.DODO_PRODUCT_ID_YEARLY?.trim();
  const id = planType === "yearly" ? yearly : monthly;
  if (!id) {
    throw new Error(
      planType === "yearly"
        ? "DODO_PRODUCT_ID_YEARLY is not configured"
        : "DODO_PRODUCT_ID_MONTHLY is not configured",
    );
  }
  return id;
}

function resolveDodoCheckoutReturnUrl(): string {
  const explicit = process.env.DODO_CHECKOUT_RETURN_URL?.trim();
  if (explicit) return explicit;
  const origin =
    process.env.CLIENT_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.PAYPAL_CHECKOUT_ORIGIN?.trim();
  if (origin) {
    const base = origin.replace(/\/$/, "");
    return `${base}/pricing?dodo=return`;
  }
  throw new Error(
    "Dodo return URL missing: set DODO_CHECKOUT_RETURN_URL or CLIENT_URL / NEXT_PUBLIC_SITE_URL",
  );
}

function resolveDodoCheckoutCancelUrl(): string | undefined {
  const explicit = process.env.DODO_CHECKOUT_CANCEL_URL?.trim();
  if (explicit) return explicit;
  const origin =
    process.env.CLIENT_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.PAYPAL_CHECKOUT_ORIGIN?.trim();
  if (origin) {
    const base = origin.replace(/\/$/, "");
    return `${base}/pricing?dodo=cancel`;
  }
  return undefined;
}

export function createDodoApiClient(): DodoPayments {
  const bearerToken = process.env.DODO_PAYMENTS_API_KEY?.trim();
  if (!bearerToken) {
    throw new Error("DODO_PAYMENTS_API_KEY is not configured");
  }
  return new DodoPayments({
    bearerToken,
    environment: getDodoEnvironment(),
  });
}

export async function createDodoCheckoutSession(params: {
  planType: DodoBillingPlanType;
  userId: string;
  customerEmail: string;
}): Promise<{ checkoutUrl: string }> {
  const client = createDodoApiClient();
  const productId = getDodoProductId(params.planType);
  const returnUrl = resolveDodoCheckoutReturnUrl();
  const cancelUrl = resolveDodoCheckoutCancelUrl();

  const session = await client.checkoutSessions.create({
    product_cart: [{ product_id: productId, quantity: 1 }],
    customer: {
      email: params.customerEmail,
    },
    metadata: {
      userId: params.userId,
    },
    return_url: returnUrl,
    cancel_url: cancelUrl ?? null,
  });

  const checkoutUrl = session.checkout_url?.trim();
  if (!checkoutUrl) {
    throw new Error("Dodo checkout session response missing checkout_url");
  }
  return { checkoutUrl };
}

function readHeader(headers: Record<string, unknown>, name: string): string | undefined {
  const direct = headers[name];
  if (typeof direct === "string" && direct) return direct;
  const lower = headers[name.toLowerCase()];
  if (typeof lower === "string" && lower) return lower;
  return undefined;
}

/**
 * Verifies Standard Webhooks signature using raw UTF-8 body (same bytes as received).
 */
export function verifyAndParseDodoWebhook(
  rawBodyUtf8: string,
  headers: Record<string, unknown>,
): UnwrapWebhookEvent {
  const webhookKey = process.env.DODO_PAYMENTS_WEBHOOK_KEY?.trim();
  if (!webhookKey) {
    throw new Error("DODO_PAYMENTS_WEBHOOK_KEY is not configured");
  }

  const client = new DodoPayments({
    bearerToken: process.env.DODO_PAYMENTS_API_KEY?.trim() ?? "",
    environment: getDodoEnvironment(),
    webhookKey,
  });

  const webhookId = readHeader(headers, "webhook-id") ?? "";
  const webhookSignature = readHeader(headers, "webhook-signature") ?? "";
  const webhookTimestamp = readHeader(headers, "webhook-timestamp") ?? "";

  return client.webhooks.unwrap(rawBodyUtf8, {
    key: webhookKey,
    headers: {
      "webhook-id": webhookId,
      "webhook-signature": webhookSignature,
      "webhook-timestamp": webhookTimestamp,
    },
  });
}
