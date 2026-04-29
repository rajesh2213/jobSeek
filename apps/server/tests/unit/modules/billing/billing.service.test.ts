import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPayPalSubscriptionEvent,
  resolvePlanFromSubscriptions,
  statusFromPayPalEvent,
} from "../../../../src/modules/billing/billing.service.js";

test("maps PAYMENT.FAILED to past_due", () => {
  assert.equal(statusFromPayPalEvent("BILLING.SUBSCRIPTION.PAYMENT.FAILED"), "past_due");
});

test("keeps pro when at least one active subscription exists", () => {
  const now = new Date("2026-04-29T00:00:00.000Z");
  const plan = resolvePlanFromSubscriptions(
    [
      { status: "active", currentPeriodEnd: new Date("2026-05-29T00:00:00.000Z"), graceEndsAt: null },
      { status: "canceled", currentPeriodEnd: new Date("2026-04-15T00:00:00.000Z"), graceEndsAt: null },
    ],
    now,
  );
  assert.equal(plan, "pro");
});

test("downgrades to free when all subscriptions are non-active and out of period/grace", () => {
  const now = new Date("2026-04-29T00:00:00.000Z");
  const plan = resolvePlanFromSubscriptions(
    [
      { status: "canceled", currentPeriodEnd: new Date("2026-04-20T00:00:00.000Z"), graceEndsAt: null },
      { status: "past_due", currentPeriodEnd: new Date("2026-04-18T00:00:00.000Z"), graceEndsAt: new Date("2026-04-25T00:00:00.000Z") },
    ],
    now,
  );
  assert.equal(plan, "free");
});

test("event replay safety: same event id does not apply twice", async () => {
  const processed = new Set<string>();
  let upsertCalls = 0;
  let userUpdateCalls = 0;

  const fakeServer = {
    prisma: {
      $transaction: async (fn: (tx: any) => Promise<{ applied: boolean }>) =>
        fn({
          processedWebhookEvent: {
            findUnique: async ({ where }: { where: { eventId: string } }) =>
              processed.has(where.eventId) ? { id: "p1" } : null,
            create: async ({ data }: { data: { eventId: string } }) => {
              processed.add(data.eventId);
              return { id: "p1" };
            },
          },
          subscription: {
            upsert: async () => {
              upsertCalls += 1;
              return {};
            },
            findMany: async () => [
              { status: "active", currentPeriodEnd: new Date("2099-01-01T00:00:00.000Z"), graceEndsAt: null },
            ],
          },
          user: {
            update: async () => {
              userUpdateCalls += 1;
              return {};
            },
          },
        }),
    },
  } as any;

  const first = await applyPayPalSubscriptionEvent(fakeServer, {
    eventId: "evt_same",
    eventType: "BILLING.SUBSCRIPTION.ACTIVATED",
    eventAt: new Date(),
    paypalId: "I-SUB-1",
    userId: "user_1",
    status: "active",
    currentPeriodEnd: new Date("2099-01-01T00:00:00.000Z"),
  });
  const second = await applyPayPalSubscriptionEvent(fakeServer, {
    eventId: "evt_same",
    eventType: "BILLING.SUBSCRIPTION.ACTIVATED",
    eventAt: new Date(),
    paypalId: "I-SUB-1",
    userId: "user_1",
    status: "active",
    currentPeriodEnd: new Date("2099-01-01T00:00:00.000Z"),
  });

  assert.equal(first.applied, true);
  assert.equal(second.applied, false);
  assert.equal(upsertCalls, 1);
  assert.equal(userUpdateCalls, 1);
});
