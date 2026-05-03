/**
 * Verify billing plan IDs against live/sandbox credentials (honours PAYPAL_MODE).
 *
 * Usage (from apps/server):
 *   npx tsx scripts/diagnose.paypalPlan.ts [PLAN_ID]
 * Defaults monthly plan id from PAYPAL_PLAN_ID_MONTHLY.
 */
import "./scriptEnv.js";
import { fetchPayPalBillingPlan } from "../src/modules/billing/paypal.client.js";

const planId = process.argv[2]?.trim() || process.env.PAYPAL_PLAN_ID_MONTHLY?.trim();
if (!planId) {
  console.error("Usage: npx tsx scripts/diagnose.paypalPlan.ts [PLAN_ID]");
  process.exit(1);
}

try {
  const p = await fetchPayPalBillingPlan(planId);
  console.log(JSON.stringify(p, null, 2));
  if (String(p.status ?? "").toUpperCase() !== "ACTIVE") {
    console.error("\nPlan status is not ACTIVE — recreate the plan or activate it in PayPal.");
    process.exit(2);
  }
} catch (err) {
  console.error("PayPal GET plan failed — wrong PAYPAL_MODE vs plan id, invalid credentials, or plan deleted:");
  console.error(err);
  process.exit(1);
}
