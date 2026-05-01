import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyRequest } from "fastify";
import { isLikelyPrefetchRequest } from "../../../src/utils/clientNavigationHints.js";

function req(headers: Record<string, string | undefined>): FastifyRequest {
  return { headers } as FastifyRequest;
}

test("isLikelyPrefetchRequest detects Next router prefetch", () => {
  assert.equal(isLikelyPrefetchRequest(req({ "next-router-prefetch": "1" })), true);
});

test("isLikelyPrefetchRequest detects segment prefetch header", () => {
  assert.equal(isLikelyPrefetchRequest(req({ "next-router-segment-prefetch": "/seg" })), true);
});

test("isLikelyPrefetchRequest detects purpose prefetch", () => {
  assert.equal(isLikelyPrefetchRequest(req({ purpose: "prefetch" })), true);
});

test("isLikelyPrefetchRequest detects sec-purpose prefetch", () => {
  assert.equal(isLikelyPrefetchRequest(req({ "sec-purpose": "prefetch" })), true);
});

test("isLikelyPrefetchRequest is false for normal navigation", () => {
  assert.equal(isLikelyPrefetchRequest(req({})), false);
  assert.equal(isLikelyPrefetchRequest(req({ "user-agent": "Mozilla/5.0" })), false);
});
