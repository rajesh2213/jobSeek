import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkdaySlug } from "../../../../../src/modules/atsDiscovery/atsUrlParser.js";
import {
  computeDiscoveryConfidence,
  computeInventoryIntelligence,
  classifyActivationTier,
  isSuspiciousDiscoverySlug,
  recomputeInventoryIntelligenceFromStored,
} from "../../../../../src/modules/providers/providers/openclaw/openclaw.discoveryQuality.js";

describe("isSuspiciousDiscoverySlug", () => {
  test("rejects workday site that looks like a job req", () => {
    const slug = buildWorkdaySlug({
      host: "abb.wd3.myworkdayjobs.com",
      tenant: "abb",
      site: "sales-specialist_jr00022498",
    });
    assert.equal(isSuspiciousDiscoverySlug("workday", slug), true);
  });

  test("accepts stable workday board site", () => {
    const slug = buildWorkdaySlug({
      host: "cohesity.wd5.myworkdayjobs.com",
      tenant: "cohesity",
      site: "cohesity_careers",
    });
    assert.equal(isSuspiciousDiscoverySlug("workday", slug), false);
  });

  test("rejects uuid slug for ashby", () => {
    assert.equal(
      isSuspiciousDiscoverySlug("ashby", "dd69e9f1-c364-4616-af6b-5b8c6b7c06eb"),
      true,
    );
  });
});

describe("computeInventoryIntelligence", () => {
  test("repeat discovery increases seen count and boost", () => {
    const candidate = {
      type: "ashby" as const,
      slug: "acme",
      baseUrl: "https://jobs.ashbyhq.com/acme",
      crawlToken: "acme",
    };
    const quality = { confidence: 76, activationCandidateScore: 59, reason: "listing_host" };
    const first = computeInventoryIntelligence({ candidate, quality, prev: null });
    const second = computeInventoryIntelligence({
      candidate,
      quality,
      prev: first,
    });
    assert.equal(second.discoverySeenCount, 2);
    assert.ok(second.repeatDiscoveryBoost > first.repeatDiscoveryBoost);
    assert.ok(second.discoveryConfidence >= first.discoveryConfidence);
  });

  test("stale sweep marks old last-seen as stale", () => {
    const candidate = {
      type: "workable" as const,
      slug: "co",
      baseUrl: "https://apply.workable.com/co",
      crawlToken: "co",
    };
    const old = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const meta = {
      crawlToken: "co",
      openclawDiscovery: {
        discoveryConfidence: 76,
        activationCandidateScore: 59,
        candidateReason: "listing_host",
        discoveryFirstSeenAt: old,
        lastDiscoverySeenAt: old,
        discoverySeenCount: 1,
        lastDiscoveryConfidence: 76,
        repeatDiscoveryBoost: 0,
        repeatDiscoveryStrength: 22,
        freshnessConfidence: 50,
        activationReadinessScore: 60,
        activationCandidateTier: "OBSERVE_LONGER" as const,
        inventoryAgeDays: 20,
        staleCandidate: false,
        atsTrustScore: 78,
        endpointStability: 10,
        rediscoveryFrequency: 0.05,
      },
    };
    const next = recomputeInventoryIntelligenceFromStored(candidate, meta);
    assert.ok(next);
    assert.equal(next!.openclawDiscovery.staleCandidate, true);
  });
});

describe("classifyActivationTier", () => {
  test("high confidence requires score and repeat observations", () => {
    assert.equal(
      classifyActivationTier({
        activationReadinessScore: 82,
        discoverySeenCount: 2,
        staleCandidate: false,
        suspicious: false,
      }),
      "HIGH_CONFIDENCE",
    );
    assert.equal(
      classifyActivationTier({
        activationReadinessScore: 82,
        discoverySeenCount: 1,
        staleCandidate: false,
        suspicious: false,
      }),
      "OBSERVE_LONGER",
    );
  });
});

describe("computeDiscoveryConfidence", () => {
  test("lowers confidence on sync collision", () => {
    const candidate = {
      type: "ashby" as const,
      slug: "acme",
      baseUrl: "https://jobs.ashbyhq.com/acme",
      crawlToken: "acme",
    };
    const a = computeDiscoveryConfidence({
      candidate,
      canonicalCollision: false,
      sourceUrl: "https://jobs.ashbyhq.com/acme/uuid",
    });
    const b = computeDiscoveryConfidence({
      candidate,
      canonicalCollision: true,
      sourceUrl: "https://jobs.ashbyhq.com/acme/uuid",
    });
    assert.ok(b.confidence < a.confidence);
  });
});
