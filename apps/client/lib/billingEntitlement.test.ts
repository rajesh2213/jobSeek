import test from "node:test";
import assert from "node:assert/strict";
import { isBillingSubscriptionEntitled } from "./billingEntitlement";

test("UI entitlement: canceled-but-active subscription still entitled", () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const entitled = isBillingSubscriptionEntitled({
    status: "canceled",
    currentPeriodEnd: future,
    graceEndsAt: null,
  });
  assert.equal(entitled, true);
});
