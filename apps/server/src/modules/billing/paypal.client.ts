import paypal from "@paypal/checkout-server-sdk";
import paypalhttp from "@paypal/paypalhttp";

export type BillingPlanType = "monthly" | "yearly";
type PayPalMode = "sandbox" | "live";
export type VerifyPayPalWebhookResult = {
  verificationStatus: string;
  verified: boolean;
};
export type PayPalSubscriptionDetails = {
  id: string;
  status: string;
  nextBillingTime: Date | null;
  customId: string | null;
};
export type CancelPayPalSubscriptionResult = {
  alreadyCanceled: boolean;
  responseCode?: number;
  providerStatus?: string;
};
const VERIFY_TIMEOUT_MS = 3000;
const VERIFY_MAX_ATTEMPTS = 3; // initial + 2 retries

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function getPayPalPlanId(planType: BillingPlanType): string {
  if (planType === "monthly") {
    return readRequiredEnv("PAYPAL_PLAN_ID_MONTHLY");
  }
  return readRequiredEnv("PAYPAL_PLAN_ID_YEARLY");
}

export function getPayPalWebhookId(): string {
  return readRequiredEnv("PAYPAL_WEBHOOK_ID");
}

/**
 * PayPal subscription approval requires absolute HTTPS return/cancel URLs in production (live mode).
 * Prefer explicit PAYPAL_RETURN_URL / PAYPAL_CANCEL_URL; otherwise derive from CLIENT_URL or NEXT_PUBLIC_SITE_URL.
 */
export function resolvePayPalSubscriptionCheckoutUrls(): { returnUrl: string; cancelUrl: string } {
  const explicitReturn = process.env.PAYPAL_RETURN_URL?.trim();
  const explicitCancel = process.env.PAYPAL_CANCEL_URL?.trim();
  const originRaw =
    process.env.PAYPAL_CHECKOUT_ORIGIN?.trim() ||
    process.env.CLIENT_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "";

  const normalizeOrigin = (raw: string): string => raw.replace(/\/+$/, "");

  const validateAbsolute = (label: string, url: string): void => {
    try {
      const u = new URL(url);
      if (u.protocol !== "https:" && u.protocol !== "http:") {
        throw new Error(`${label} must be http(s)`);
      }
      if (process.env.NODE_ENV === "production" && u.protocol !== "https:") {
        throw new Error(
          `${label} must use https:// in production (PayPal live rejects plain http except special cases).`,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Invalid ${label}: ${msg}`);
    }
  };

  const origin = originRaw ? normalizeOrigin(originRaw) : "";
  const returnUrl =
    explicitReturn || (origin ? `${origin}/pricing?paypal=return` : "");
  const cancelUrl =
    explicitCancel || (origin ? `${origin}/pricing?paypal=cancel` : "");

  if (!returnUrl || !cancelUrl) {
    throw new Error(
      "PayPal checkout URLs missing: set PAYPAL_RETURN_URL and PAYPAL_CANCEL_URL, or set CLIENT_URL / NEXT_PUBLIC_SITE_URL (or PAYPAL_CHECKOUT_ORIGIN) so defaults can be built.",
    );
  }

  validateAbsolute("PayPal return URL", returnUrl);
  validateAbsolute("PayPal cancel URL", cancelUrl);
  return { returnUrl, cancelUrl };
}

export function createPayPalHttpClient(): InstanceType<typeof paypal.core.PayPalHttpClient> {
  const clientId = readRequiredEnv("PAYPAL_CLIENT_ID");
  const clientSecret = readRequiredEnv("PAYPAL_CLIENT_SECRET");
  const modeRaw = process.env.PAYPAL_MODE?.trim().toLowerCase();
  if (modeRaw !== "sandbox" && modeRaw !== "live") {
    throw new Error("PAYPAL_MODE must be 'sandbox' or 'live'");
  }
  const mode: PayPalMode = modeRaw;
  const allowSandboxInProduction =
    process.env.ALLOW_PAYPAL_SANDBOX_IN_PRODUCTION?.trim().toLowerCase() === "true";
  if (process.env.NODE_ENV === "production" && mode !== "live" && !allowSandboxInProduction) {
    throw new Error("PAYPAL_MODE must be 'live' in production");
  }
  const environment =
    mode === "live"
      ? new paypal.core.LiveEnvironment(clientId, clientSecret)
      : new paypal.core.SandboxEnvironment(clientId, clientSecret);
  return new paypal.core.PayPalHttpClient(environment);
}

export async function verifyPayPalWebhook(
  headers: Record<string, string | undefined>,
  body: unknown,
): Promise<VerifyPayPalWebhookResult> {
  const requiredHeaders = [
    "paypal-auth-algo",
    "paypal-cert-url",
    "paypal-transmission-id",
    "paypal-transmission-sig",
    "paypal-transmission-time",
  ] as const;
  for (const header of requiredHeaders) {
    const value = headers[header]?.trim();
    if (!value) {
      return { verificationStatus: "MISSING_HEADERS", verified: false };
    }
  }

  const webhookId = getPayPalWebhookId();
  const client = createPayPalHttpClient();
  const request: paypalhttp.HttpRequest = {
    path: "/v1/notifications/verify-webhook-signature",
    verb: "POST",
    headers: { "content-type": "application/json" },
    body: {
      auth_algo: headers["paypal-auth-algo"],
      cert_url: headers["paypal-cert-url"],
      transmission_id: headers["paypal-transmission-id"],
      transmission_sig: headers["paypal-transmission-sig"],
      transmission_time: headers["paypal-transmission-time"],
      webhook_id: webhookId,
      webhook_event: body,
    },
  };

  const response = await executeWithTimeoutAndNetworkRetry(client, request, {
    timeoutMs: VERIFY_TIMEOUT_MS,
    maxAttempts: VERIFY_MAX_ATTEMPTS,
  });
  const verificationStatus =
    (response.result as { verification_status?: string }).verification_status ?? "UNKNOWN";
  return {
    verificationStatus,
    verified: verificationStatus === "SUCCESS",
  };
}

function isRetryableNetworkError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string") {
    return [
      "ETIMEDOUT",
      "ECONNRESET",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ECONNREFUSED",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_SOCKET",
      "ABORT_ERR",
    ].includes(code);
  }
  return false;
}

async function executeWithTimeoutAndNetworkRetry(
  client: InstanceType<typeof paypal.core.PayPalHttpClient>,
  request: paypalhttp.HttpRequest,
  options: { timeoutMs: number; maxAttempts: number },
) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      const response = await Promise.race([
        client.execute(request),
        new Promise<never>((_, reject) => {
          const timeoutErr = new Error(`PayPal request timed out after ${options.timeoutMs}ms`) as Error & {
            code?: string;
          };
          timeoutErr.code = "ETIMEDOUT";
          setTimeout(() => reject(timeoutErr), options.timeoutMs);
        }),
      ]);
      return response;
    } catch (err) {
      lastError = err;
      if (!isRetryableNetworkError(err)) {
        throw err;
      }
      if (attempt >= options.maxAttempts) {
        break;
      }
    }
  }
  throw lastError;
}

/** Inspect a billing plan (live vs sandbox follows PAYPAL_MODE). Throws if PayPal API errors (wrong env or invalid id). */
export async function fetchPayPalBillingPlan(planId: string): Promise<{
  id: string;
  status?: string;
  name?: string;
  description?: string;
}> {
  const client = createPayPalHttpClient();
  const request: paypalhttp.HttpRequest = {
    path: `/v1/billing/plans/${encodeURIComponent(planId)}`,
    verb: "GET",
    headers: { "Content-Type": "application/json" },
    body: {},
  };
  const response = await client.execute(request);
  const result = response.result as {
    id?: string;
    status?: string;
    name?: string;
    description?: string;
  };
  if (!result.id) {
    throw new Error("PayPal plan response missing id");
  }
  return {
    id: result.id,
    status: result.status,
    name: result.name,
    description: result.description,
  };
}

export async function fetchPayPalSubscriptionDetails(
  subscriptionId: string,
): Promise<PayPalSubscriptionDetails | null> {
  const client = createPayPalHttpClient();
  const request: paypalhttp.HttpRequest = {
    path: `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`,
    verb: "GET",
    headers: { "content-type": "application/json" },
    body: {},
  };
  const response = await client.execute(request);
  const result = response.result as {
    id?: string;
    status?: string;
    billing_info?: { next_billing_time?: string };
  };
  if (!result.id) return null;
  const nextRaw = result.billing_info?.next_billing_time;
  const nextBillingTime =
    typeof nextRaw === "string" && nextRaw.trim() && !Number.isNaN(new Date(nextRaw).getTime())
      ? new Date(nextRaw)
      : null;
  return {
    id: result.id,
    status: result.status ?? "UNKNOWN",
    nextBillingTime,
    customId: typeof (result as { custom_id?: unknown }).custom_id === "string"
      ? (result as { custom_id: string }).custom_id
      : null,
  };
}

export async function cancelPayPalSubscription(
  subscriptionId: string,
  reason: string,
): Promise<CancelPayPalSubscriptionResult> {
  const client = createPayPalHttpClient();
  const request: paypalhttp.HttpRequest = {
    path: `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
    verb: "POST",
    headers: { "content-type": "application/json" },
    body: { reason },
  };
  try {
    await executeWithTimeoutAndNetworkRetry(client, request, {
      timeoutMs: VERIFY_TIMEOUT_MS,
      maxAttempts: VERIFY_MAX_ATTEMPTS,
    });
    return { alreadyCanceled: false, responseCode: 204 };
  } catch (err) {
    const statusCode = err && typeof err === "object" && "statusCode" in err
      ? Number((err as { statusCode?: unknown }).statusCode)
      : undefined;
    if (isPayPalCancelAlreadyInactiveError(statusCode, err)) {
      return {
        alreadyCanceled: true,
        responseCode: statusCode,
        providerStatus: "already_inactive",
      };
    }
    throw err;
  }
}

export function isPayPalCancelAlreadyInactiveError(
  statusCode: number | undefined,
  err: unknown,
): boolean {
  const rawMessage = err instanceof Error ? err.message : String(err);
  const upper = rawMessage.toUpperCase();
  const alreadyCanceledHint =
    upper.includes("CANCELLED") ||
    upper.includes("CANCELED") ||
    upper.includes("INACTIVE") ||
    upper.includes("SUSPENDED") ||
    upper.includes("INVALID") ||
    upper.includes("STATUS");
  return statusCode === 422 && alreadyCanceledHint;
}
