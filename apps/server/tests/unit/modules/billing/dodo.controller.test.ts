import test from "node:test";
import assert from "node:assert/strict";
import { pickDodoCurrentPeriodEnd } from "../../../../src/modules/billing/dodo.controller.js";

test("Dodo period fallback: keeps existing period end when later than now", () => {
  const now = new Date("2026-05-06T10:00:00.000Z");
  const existing = new Date("2026-05-10T10:00:00.000Z");
  const selected = pickDodoCurrentPeriodEnd({
    eventPeriodEnd: null,
    existingPeriodEnd: existing,
    providerPeriodEnd: null,
    now,
  });
  assert.equal(selected.currentPeriodEnd.toISOString(), existing.toISOString());
  assert.equal(selected.fallbackSourceUsed, "db.currentPeriodEnd");
});
