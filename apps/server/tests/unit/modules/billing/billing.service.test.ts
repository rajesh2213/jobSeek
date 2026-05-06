import test from "node:test";
import assert from "node:assert/strict";
import {
  applyDodoSubscriptionEvent,
  applyPayPalSubscriptionEvent,
  resolvePlanFromSubscriptions,
  statusFromDodoEvent,
  statusFromPayPalEvent,
} from "../../../../src/modules/billing/billing.service.js";

test("maps PAYMENT.FAILED to past_due", () => {
  assert.equal(statusFromPayPalEvent("BILLING.SUBSCRIPTION.PAYMENT.FAILED"), "past_due");
});

test("maps Dodo payment.failed to past_due and subscription.cancelled to canceled", () => {
  assert.equal(statusFromDodoEvent("payment.failed"), "past_due");
  assert.equal(statusFromDodoEvent("subscription.cancelled"), "canceled");
  assert.equal(statusFromDodoEvent("subscription.canceled"), "canceled");
  assert.equal(statusFromDodoEvent("payment.unknown"), null);
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
      {
        status: "past_due",
        currentPeriodEnd: new Date("2026-04-18T00:00:00.000Z"),
        graceEndsAt: new Date("2026-04-25T00:00:00.000Z"),
      },
    ],
    now,
  );
  assert.equal(plan, "free");
});

test("keeps pro while canceled subscription is still within paid period", () => {
  const now = new Date("2026-05-06T10:00:00.000Z");
  const plan = resolvePlanFromSubscriptions(
    [
      { status: "canceled", currentPeriodEnd: new Date("2026-05-09T10:00:00.000Z"), graceEndsAt: null },
    ],
    now,
  );
  assert.equal(plan, "pro");
});

function mockTxFactory() {
  const processed = new Set<string>();
  let subscriptionWrites = 0;
  let userUpdateCalls = 0;

  const tx = {
    processedWebhookEvent: {
      findUnique: async ({ where }: { where: { eventId: string } }) =>
        processed.has(where.eventId) ? { id: "p1" } : null,
      create: async ({ data }: { data: { eventId: string } }) => {
        processed.add(data.eventId);
        return { id: "p1" };
      },
    },
    subscription: {
      findUnique: async () => null,
      create: async () => {
        subscriptionWrites += 1;
        return {};
      },
      update: async () => {
        subscriptionWrites += 1;
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
  };

  return { tx, get subscriptionWrites() {
    return subscriptionWrites;
  }, get userUpdateCalls() {
    return userUpdateCalls;
  } };
}

test("event replay safety: same event id does not apply twice", async () => {
  const m = mockTxFactory();

  const fakeServer = {
    log: {
      info: () => {},
    },
    prisma: {
      $transaction: async (fn: (tx: any) => Promise<{ applied: boolean }>) => fn(m.tx),
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
  assert.equal(m.subscriptionWrites, 1);
  assert.equal(m.userUpdateCalls, 1);
});

test("older eventAt does not overwrite subscription (stale)", async () => {
  const processed = new Set<string>();
  let updateCalls = 0;
  let userUpdates = 0;

  const newer = new Date("2026-05-01T12:00:00.000Z");
  const older = new Date("2026-04-01T12:00:00.000Z");

  const tx = {
    processedWebhookEvent: {
      findUnique: async ({ where }: { where: { eventId: string } }) =>
        processed.has(where.eventId) ? { id: "p" } : null,
      create: async ({ data }: { data: { eventId: string } }) => {
        processed.add(data.eventId);
        return { id: "p" };
      },
    },
    subscription: {
      findUnique: async () => ({
        userId: "user_1",
        lastEventAt: newer,
        status: "active",
        currentPeriodEnd: new Date("2099-01-01T00:00:00.000Z"),
        graceEndsAt: null,
      }),
      create: async () => ({}),
      update: async () => {
        updateCalls += 1;
        return {};
      },
      findMany: async () => [
        { status: "active", currentPeriodEnd: new Date("2099-01-01T00:00:00.000Z"), graceEndsAt: null },
      ],
    },
    user: {
      update: async () => {
        userUpdates += 1;
        return {};
      },
    },
  };

  const fakeServer = {
    log: {
      info: () => {},
    },
    prisma: {
      $transaction: async (fn: (t: any) => Promise<unknown>) => fn(tx),
    },
  } as any;

  const r = await applyDodoSubscriptionEvent(fakeServer, {
    eventId: "evt_stale_1",
    eventType: "payment.failed",
    eventAt: older,
    dodoSubscriptionId: "sub_dodo_1",
    userId: "user_1",
    status: "past_due",
    currentPeriodEnd: new Date(),
    providerTimestampIso: older.toISOString(),
  });

  assert.equal(r.applied, false);
  assert.equal(r.stale, true);
  assert.equal(updateCalls, 0);
  assert.equal(userUpdates, 0);
});

test("Dodo synthetic dedupe id is stable for same provider timestamp", async () => {
  const processed = new Set<string>();
  let writes = 0;

  const tx = {
    processedWebhookEvent: {
      findUnique: async ({ where }: { where: { eventId: string } }) =>
        processed.has(where.eventId) ? { id: "p" } : null,
      create: async ({ data }: { data: { eventId: string } }) => {
        processed.add(data.eventId);
        return { id: "p" };
      },
    },
    subscription: {
      findUnique: async () => null,
      create: async () => {
        writes += 1;
        return {};
      },
      update: async () => {
        writes += 1;
        return {};
      },
      findMany: async () => [
        { status: "active", currentPeriodEnd: new Date("2099-01-01T00:00:00.000Z"), graceEndsAt: null },
      ],
    },
    user: {
      update: async () => ({}),
    },
  };

  const fakeServer = {
    log: {
      info: () => {},
    },
    prisma: {
      $transaction: async (fn: (t: any) => Promise<unknown>) => fn(tx),
    },
  } as any;

  const iso = "2026-05-03T10:00:00.000Z";
  const first = await applyDodoSubscriptionEvent(fakeServer, {
    eventId: null,
    eventType: "subscription.active",
    eventAt: new Date(iso),
    dodoSubscriptionId: "sub_x",
    userId: "u1",
    status: "active",
    currentPeriodEnd: new Date("2099-01-01T00:00:00.000Z"),
    providerTimestampIso: iso,
  });
  const second = await applyDodoSubscriptionEvent(fakeServer, {
    eventId: null,
    eventType: "subscription.active",
    eventAt: new Date(iso),
    dodoSubscriptionId: "sub_x",
    userId: "u1",
    status: "active",
    currentPeriodEnd: new Date("2099-01-01T00:00:00.000Z"),
    providerTimestampIso: iso,
  });

  assert.equal(first.applied, true);
  assert.equal(second.applied, false);
  assert.equal(writes, 1);
});
