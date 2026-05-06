import test from "node:test";
import assert from "node:assert/strict";
import { isPayPalCancelAlreadyInactiveError } from "../../../../src/modules/billing/paypal.client.js";

test("PayPal cancel: 422 already canceled is treated as idempotent", () => {
  const err = new Error('{"name":"UNPROCESSABLE_ENTITY","message":"Subscription is CANCELLED"}');
  const r = isPayPalCancelAlreadyInactiveError(422, err);
  assert.equal(r, true);
});

test("PayPal cancel: non-422 is not treated as already canceled", () => {
  const err = new Error("upstream timeout");
  const r = isPayPalCancelAlreadyInactiveError(504, err);
  assert.equal(r, false);
});
