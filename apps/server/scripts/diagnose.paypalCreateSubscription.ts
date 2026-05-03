/**
 * Dry-run: POST /v1/billing/subscriptions (does not activate until buyer approves).
 * Prints approve URL or PayPal API error JSON — use to separate API failures vs hosted-page failures.
 *
 * Usage (apps/server): npx tsx scripts/diagnose.paypalCreateSubscription.ts [--minimal]
 */
import "./scriptEnv.js";
import paypalhttp from "@paypal/paypalhttp";
import {
  createPayPalHttpClient,
  resolvePayPalSubscriptionCheckoutUrls,
} from "../src/modules/billing/paypal.client.js";

const minimal = process.argv.includes("--minimal");
const planId = process.env.PAYPAL_PLAN_ID_MONTHLY?.trim();
if (!planId) {
  console.error("PAYPAL_PLAN_ID_MONTHLY is required");
  process.exit(1);
}

const client = createPayPalHttpClient();
const { returnUrl, cancelUrl } = resolvePayPalSubscriptionCheckoutUrls();

const baseBody: Record<string, unknown> = {
  plan_id: planId,
  custom_id: "00000000-0000-4000-8000-000000000099",
  start_time: new Date(Date.now() + 120_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
  application_context: {
    brand_name: "JobLoom",
    locale: "en-US",
    user_action: "SUBSCRIBE_NOW",
    shipping_preference: "NO_SHIPPING",
    return_url: returnUrl,
    cancel_url: cancelUrl,
  },
};

if (!minimal) {
  (baseBody.application_context as Record<string, unknown>).payment_method = {
    payer_selected: "PAYPAL",
    payee_preferred:
      process.env.PAYPAL_PAYEE_PREFERRED?.trim().toUpperCase() === "IMMEDIATE_PAYMENT_REQUIRED"
        ? "IMMEDIATE_PAYMENT_REQUIRED"
        : "UNRESTRICTED",
  };
}

const request: paypalhttp.HttpRequest = {
  path: "/v1/billing/subscriptions",
  verb: "POST",
  headers: {
    "Content-Type": "application/json",
    Prefer: "return=representation",
  },
  body: baseBody,
};

try {
  const response = await client.execute(request);
  const result = response.result as {
    id?: string;
    status?: string;
    links?: Array<{ href?: string; rel?: string }>;
  };
  const approve = result.links?.find((l) => l.rel === "approve")?.href;
  console.log(JSON.stringify({ ok: true, id: result.id, status: result.status, approve }, null, 2));
  if (approve) {
    console.log("\nOpen approve URL in a fresh browser profile to reproduce hosted checkout:");
    console.log(approve.slice(0, 120) + "…");
  }
} catch (err: unknown) {
  const o = err as Record<string, unknown>;
  const msg = typeof o.message === "string" ? o.message : String(err);
  let parsed: unknown;
  try {
    parsed = JSON.parse(msg);
  } catch {
    parsed = msg;
  }
  console.error(JSON.stringify({ ok: false, statusCode: o.statusCode, details: parsed }, null, 2));
  process.exit(1);
}
