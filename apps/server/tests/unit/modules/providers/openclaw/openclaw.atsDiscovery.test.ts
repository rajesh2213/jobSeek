import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  inferAtsCandidate,
  createEmptyAtsDiscoverySummary,
  mergeAtsDiscoveryIntoSummary,
  type OpenClawAtsDiscoveryEvalResult,
} from "../../../../../src/modules/providers/providers/openclaw/openclaw.atsDiscovery.js";

describe("inferAtsCandidate", () => {
  test("detects workday and normalizes slug", () => {
    const r = inferAtsCandidate(
      "https://servicetitan.wd1.myworkdayjobs.com/en-US/External/job/Glendale-CA/Senior-Engineer_JR102831",
    );
    assert.equal(r.status, "supported");
    if (r.status !== "supported") return;
    assert.equal(r.candidate.type, "workday");
    assert.ok(r.candidate.slug.length > 0);
    assert.ok(r.candidate.baseUrl.includes("myworkdayjobs.com") || r.candidate.baseUrl.includes("wday"));
  });

  test("detects ashby (API-style URL with /jobs/ path)", () => {
    const r = inferAtsCandidate(
      "https://api.ashbyhq.com/jobs/ramp/f5e2e8e2-1234-5678-abcd-abcdef123456",
    );
    assert.equal(r.status, "supported");
    if (r.status !== "supported") return;
    assert.equal(r.candidate.type, "ashby");
    assert.equal(r.candidate.slug, "ramp");
    assert.equal(r.candidate.baseUrl, "https://jobs.ashbyhq.com/ramp");
  });

  test("conservatively rejects ashby listing URL without /jobs/ path", () => {
    const r = inferAtsCandidate(
      "https://jobs.ashbyhq.com/ramp/f5e2e8e2-1234",
    );
    assert.equal(r.status, "rejected");
    if (r.status !== "rejected") return;
    assert.equal(r.reason, "slug_extraction_failed");
  });

  test("detects workable (URL with /accounts/ path)", () => {
    const r = inferAtsCandidate(
      "https://www.workable.com/accounts/acme/jobs/1234",
    );
    assert.equal(r.status, "supported");
    if (r.status !== "supported") return;
    assert.equal(r.candidate.type, "workable");
    assert.equal(r.candidate.slug, "acme");
    assert.equal(r.candidate.baseUrl, "https://apply.workable.com/acme");
  });

  test("conservatively rejects workable listing URL without /accounts/ path", () => {
    const r = inferAtsCandidate(
      "https://apply.workable.com/acme/j/ABCDEF1234/",
    );
    assert.equal(r.status, "rejected");
    if (r.status !== "rejected") return;
    assert.equal(r.reason, "slug_extraction_failed");
  });

  test("detects bamboohr and normalizes", () => {
    const r = inferAtsCandidate(
      "https://foocorp.bamboohr.com/careers/123",
    );
    assert.equal(r.status, "supported");
    if (r.status !== "supported") return;
    assert.equal(r.candidate.type, "bamboohr");
    assert.equal(r.candidate.slug, "foocorp");
    assert.equal(r.candidate.baseUrl, "https://foocorp.bamboohr.com/careers");
  });

  test("detects greenhouse and normalizes", () => {
    const r = inferAtsCandidate(
      "https://boards.greenhouse.io/acme/jobs/12345",
    );
    assert.equal(r.status, "supported");
    if (r.status !== "supported") return;
    assert.equal(r.candidate.type, "greenhouse");
    assert.equal(r.candidate.slug, "acme");
    assert.equal(r.candidate.baseUrl, "https://boards.greenhouse.io/acme");
  });

  test("detects lever (API-style URL with /jobs/ path)", () => {
    const r = inferAtsCandidate(
      "https://api.lever.co/jobs/stripe/abcdef-1234",
    );
    assert.equal(r.status, "supported");
    if (r.status !== "supported") return;
    assert.equal(r.candidate.type, "lever");
    assert.equal(r.candidate.slug, "stripe");
    assert.equal(r.candidate.baseUrl, "https://jobs.lever.co/stripe");
  });

  test("conservatively rejects lever listing URL without /jobs/ path", () => {
    const r = inferAtsCandidate(
      "https://jobs.lever.co/stripe/abcdef-1234",
    );
    assert.equal(r.status, "rejected");
    if (r.status !== "rejected") return;
    assert.equal(r.reason, "slug_extraction_failed");
  });

  test("rejects empty URL", () => {
    const r = inferAtsCandidate("");
    assert.equal(r.status, "rejected");
    if (r.status !== "rejected") return;
    assert.equal(r.reason, "invalid_url");
  });

  test("rejects unparseable URL", () => {
    const r = inferAtsCandidate("not-a-url");
    assert.equal(r.status, "rejected");
    if (r.status !== "rejected") return;
    assert.equal(r.reason, "invalid_url");
  });

  test("rejects unknown host (generic career page)", () => {
    const r = inferAtsCandidate("https://www.acme.com/careers/engineer");
    assert.equal(r.status, "rejected");
    if (r.status !== "rejected") return;
    assert.equal(r.reason, "unknown_host");
  });

  test("rejects unsupported ATS (smartrecruiters)", () => {
    const r = inferAtsCandidate(
      "https://careers.smartrecruiters.com/AcmeCorp/job-1234",
    );
    assert.equal(r.status, "rejected");
    if (r.status !== "rejected") return;
    assert.equal(r.reason, "unsupported_ats");
  });

  test("rejects unsupported ATS (teamtailor)", () => {
    const r = inferAtsCandidate(
      "https://acme.teamtailor.com/jobs/1234",
    );
    assert.equal(r.status, "rejected");
    if (r.status !== "rejected") return;
    assert.equal(r.reason, "unsupported_ats");
  });

  test("rejects unsupported ATS (rippling)", () => {
    const r = inferAtsCandidate(
      "https://ats.rippling.com/acme/jobs/1234",
    );
    assert.equal(r.status, "rejected");
    if (r.status !== "rejected") return;
    assert.equal(r.reason, "unsupported_ats");
  });

  test("rejects aggregator domains (join.com)", () => {
    const r = inferAtsCandidate("https://join.com/companies/acme/jobs/1234");
    assert.equal(r.status, "rejected");
    if (r.status !== "rejected") return;
    assert.equal(r.reason, "unknown_host");
  });

  test("rejects aggregator domains (gupy.io)", () => {
    const r = inferAtsCandidate("https://acme.gupy.io/jobs/1234");
    assert.equal(r.status, "rejected");
    if (r.status !== "rejected") return;
    assert.equal(r.reason, "unknown_host");
  });

  test("rejects greenhouse URL without extractable slug", () => {
    const r = inferAtsCandidate("https://api.greenhouse.io");
    assert.equal(r.status, "rejected");
    if (r.status !== "rejected") return;
    assert.ok(
      r.reason === "slug_extraction_failed" || r.reason === "unknown_host",
    );
  });
});

describe("mergeAtsDiscoveryIntoSummary", () => {
  test("aggregates supported would_create", () => {
    const summary = createEmptyAtsDiscoverySummary();
    const result: OpenClawAtsDiscoveryEvalResult = {
      sourceUrl: "https://jobs.lever.co/acme/123",
      detectedType: "lever",
      outcome: {
        status: "would_create",
        candidate: {
          type: "lever",
          slug: "acme",
          baseUrl: "https://jobs.lever.co/acme",
          crawlToken: "acme",
        },
      },
    };
    mergeAtsDiscoveryIntoSummary(summary, result);
    assert.equal(summary.evaluated, 1);
    assert.equal(summary.supported, 1);
    assert.equal(summary.would_create, 1);
    assert.equal(summary.rejected, 0);
    assert.deepStrictEqual(summary.ats_breakdown["lever"], {
      would_create: 1,
      existing: 0,
    });
  });

  test("aggregates existing_endpoint", () => {
    const summary = createEmptyAtsDiscoverySummary();
    const result: OpenClawAtsDiscoveryEvalResult = {
      sourceUrl: "https://jobs.ashbyhq.com/acme/123",
      detectedType: "ashby",
      outcome: {
        status: "existing_endpoint",
        candidate: {
          type: "ashby",
          slug: "acme",
          baseUrl: "https://jobs.ashbyhq.com/acme",
          crawlToken: "acme",
        },
      },
    };
    mergeAtsDiscoveryIntoSummary(summary, result);
    assert.equal(summary.existing_endpoint, 1);
    assert.equal(summary.would_create, 0);
    assert.deepStrictEqual(summary.ats_breakdown["ashby"], {
      would_create: 0,
      existing: 1,
    });
  });

  test("aggregates rejected with breakdown", () => {
    const summary = createEmptyAtsDiscoverySummary();
    const result: OpenClawAtsDiscoveryEvalResult = {
      sourceUrl: "https://www.unknown.com/jobs",
      detectedType: null,
      outcome: { status: "rejected", reason: "unknown_host" },
    };
    mergeAtsDiscoveryIntoSummary(summary, result);
    assert.equal(summary.evaluated, 1);
    assert.equal(summary.rejected, 1);
    assert.equal(summary.supported, 0);
    assert.equal(summary.reject_breakdown["unknown_host"], 1);
  });

  test("accumulates multiple results correctly", () => {
    const summary = createEmptyAtsDiscoverySummary();
    const results: OpenClawAtsDiscoveryEvalResult[] = [
      {
        sourceUrl: "https://jobs.lever.co/a/1",
        detectedType: "lever",
        outcome: {
          status: "would_create",
          candidate: { type: "lever", slug: "a", baseUrl: "https://jobs.lever.co/a", crawlToken: "a" },
        },
      },
      {
        sourceUrl: "https://jobs.lever.co/b/2",
        detectedType: "lever",
        outcome: {
          status: "existing_endpoint",
          candidate: { type: "lever", slug: "b", baseUrl: "https://jobs.lever.co/b", crawlToken: "b" },
        },
      },
      {
        sourceUrl: "https://random.com/x",
        detectedType: null,
        outcome: { status: "rejected", reason: "unknown_host" },
      },
      {
        sourceUrl: "",
        detectedType: null,
        outcome: { status: "rejected", reason: "invalid_url" },
      },
    ];
    for (const r of results) mergeAtsDiscoveryIntoSummary(summary, r);
    assert.equal(summary.evaluated, 4);
    assert.equal(summary.supported, 2);
    assert.equal(summary.rejected, 2);
    assert.equal(summary.would_create, 1);
    assert.equal(summary.existing_endpoint, 1);
    assert.equal(summary.reject_breakdown["unknown_host"], 1);
    assert.equal(summary.reject_breakdown["invalid_url"], 1);
    assert.deepStrictEqual(summary.ats_breakdown["lever"], {
      would_create: 1,
      existing: 1,
    });
  });
});
