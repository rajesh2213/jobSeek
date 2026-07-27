import assert from "node:assert/strict";
import test from "node:test";
import {
  isJobBusinessOpen,
  isJobExpired,
  isJobInactive,
  isJobInSeoGrace,
  isJobSeoActive,
  shouldIndexJob,
} from "./jobLifecycle";
import type { JobItem } from "./api";

function lifecycle(overrides: Partial<Pick<JobItem, "isActive" | "expiresAt">>) {
  return overrides;
}

const fixedNow = new Date("2026-06-11T12:00:00.000Z");

test("active job with future expiry is SEO-active and business-open", () => {
  const job = lifecycle({ isActive: true, expiresAt: "2026-07-01T00:00:00.000Z" });
  assert.equal(isJobInactive(job), false);
  assert.equal(isJobExpired(job, fixedNow), false);
  assert.equal(isJobBusinessOpen(job, fixedNow), true);
  assert.equal(isJobSeoActive(job, fixedNow), true);
  assert.equal(shouldIndexJob(job, fixedNow), true);
  assert.equal(isJobInSeoGrace(job, fixedNow), false);
});

test("inactive job with future expiry is not SEO-active without expiresAt-driven grace path", () => {
  // No expiresAt → isActive gates SEO.
  const job = lifecycle({ isActive: false, expiresAt: null });
  assert.equal(isJobInactive(job), true);
  assert.equal(shouldIndexJob(job, fixedNow), false);
  assert.equal(isJobBusinessOpen(job, fixedNow), false);
});

test("expired job within SEO grace remains indexable but not business-open", () => {
  // Expired 5 days ago; default grace is 12 days.
  const job = lifecycle({ isActive: false, expiresAt: "2026-06-06T00:00:00.000Z" });
  assert.equal(isJobExpired(job, fixedNow), true);
  assert.equal(isJobBusinessOpen(job, fixedNow), false);
  assert.equal(isJobSeoActive(job, fixedNow), true);
  assert.equal(shouldIndexJob(job, fixedNow), true);
  assert.equal(isJobInSeoGrace(job, fixedNow), true);
});

test("expired job past SEO grace is not SEO-active", () => {
  const job = lifecycle({ isActive: false, expiresAt: "2026-05-01T00:00:00.000Z" });
  assert.equal(isJobSeoActive(job, fixedNow), false);
  assert.equal(shouldIndexJob(job, fixedNow), false);
  assert.equal(isJobInSeoGrace(job, fixedNow), false);
});

test("missing lifecycle fields default to SEO-active", () => {
  const job = lifecycle({});
  assert.equal(shouldIndexJob(job, fixedNow), true);
  assert.equal(isJobBusinessOpen(job, fixedNow), true);
});

test("invalid expiresAt is not treated as expired", () => {
  const job = lifecycle({ isActive: true, expiresAt: "not-a-date" });
  assert.equal(isJobExpired(job, fixedNow), false);
  assert.equal(shouldIndexJob(job, fixedNow), true);
});
