import assert from "node:assert/strict";
import test from "node:test";
import {
  isJobExpired,
  isJobInactive,
  isJobSeoActive,
  shouldIndexJob,
} from "./jobLifecycle";
import type { JobItem } from "./api";

function lifecycle(overrides: Partial<Pick<JobItem, "isActive" | "expiresAt">>) {
  return overrides;
}

const fixedNow = new Date("2026-06-11T12:00:00.000Z");

test("active job with future expiry is SEO-active", () => {
  const job = lifecycle({ isActive: true, expiresAt: "2026-07-01T00:00:00.000Z" });
  assert.equal(isJobInactive(job), false);
  assert.equal(isJobExpired(job, fixedNow), false);
  assert.equal(isJobSeoActive(job, fixedNow), true);
  assert.equal(shouldIndexJob(job, fixedNow), true);
});

test("inactive job is not SEO-active", () => {
  const job = lifecycle({ isActive: false, expiresAt: "2026-07-01T00:00:00.000Z" });
  assert.equal(isJobInactive(job), true);
  assert.equal(shouldIndexJob(job, fixedNow), false);
});

test("expired job is not SEO-active", () => {
  const job = lifecycle({ isActive: true, expiresAt: "2026-06-01T00:00:00.000Z" });
  assert.equal(isJobExpired(job, fixedNow), true);
  assert.equal(shouldIndexJob(job, fixedNow), false);
});

test("missing lifecycle fields default to SEO-active", () => {
  const job = lifecycle({});
  assert.equal(shouldIndexJob(job, fixedNow), true);
});

test("invalid expiresAt is not treated as expired", () => {
  const job = lifecycle({ isActive: true, expiresAt: "not-a-date" });
  assert.equal(isJobExpired(job, fixedNow), false);
  assert.equal(shouldIndexJob(job, fixedNow), true);
});
