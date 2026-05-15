import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  inferAtsCandidate,
  parseOpenClawWorkdayBoard,
  openClawWorkdayBoardUrl,
  extractOpenClawDiscoverySlug,
  createEmptyAtsDiscoverySummary,
  createCanonicalTracker,
  trackCanonicalCandidate,
  mergeAtsDiscoveryIntoSummary,
  type OpenClawAtsDiscoveryEvalResult,
} from "../../../../../src/modules/providers/providers/openclaw/openclaw.atsDiscovery.js";

describe("parseOpenClawWorkdayBoard", () => {
  test("uses board segment before /job/, not job title", () => {
    const board = parseOpenClawWorkdayBoard(
      "https://draftkings.wd1.myworkdayjobs.com/employee_referral_portal/job/remote---bulgaria/associate-delivery-manager_jr14028-1",
    );
    assert.ok(board);
    assert.equal(board!.site, "employee_referral_portal");
    assert.equal(openClawWorkdayBoardUrl(board!), "https://draftkings.wd1.myworkdayjobs.com");
  });

  test("locale + board + job path", () => {
    const board = parseOpenClawWorkdayBoard(
      "https://servicetitan.wd1.myworkdayjobs.com/en-US/External/job/Glendale-CA/Senior-Engineer_JR102831",
    );
    assert.ok(board);
    assert.equal(board!.site, "External");
  });

  test("multiple jobs from same host share board site", () => {
    const a = parseOpenClawWorkdayBoard(
      "https://repligen.wd108.myworkdayjobs.com/repligen_careers/job/hopkinton-ma/applications-engineer-i_r-259",
    );
    const b = parseOpenClawWorkdayBoard(
      "https://repligen.wd108.myworkdayjobs.com/repligen_careers/job/remote---new-jersey/bioprocessing-sales-specialist-upstream-intensification_r-290",
    );
    assert.ok(a && b);
    assert.equal(a!.site, b!.site);
    assert.equal(a!.site, "repligen_careers");
  });
});

describe("inferAtsCandidate", () => {
  test("workday: board-level slug stable across jobs", () => {
    const urlA =
      "https://draftkings.wd1.myworkdayjobs.com/employee_referral_portal/job/remote---bulgaria/associate-delivery-manager_jr14028-1";
    const urlB =
      "https://draftkings.wd1.myworkdayjobs.com/employee_referral_portal/job/sofia-bg/security-analyst-i_jr14171-1";
    const a = inferAtsCandidate(urlA);
    const b = inferAtsCandidate(urlB);
    assert.equal(a.status, "supported");
    assert.equal(b.status, "supported");
    if (a.status !== "supported" || b.status !== "supported") return;
    assert.equal(a.candidate.slug, b.candidate.slug);
    assert.ok(a.candidate.baseUrl.includes("employee_referral_portal"));
    assert.ok(!a.candidate.slug.includes("security-analyst"));
    assert.equal(a.canonicalBoardUrl, "https://draftkings.wd1.myworkdayjobs.com");
  });

  test("detects ashby listing URL on jobs.ashbyhq.com", () => {
    const r = inferAtsCandidate(
      "https://jobs.ashbyhq.com/docker/dd69e9f1-c364-4616-af6b-5b8c6b7c06eb",
    );
    assert.equal(r.status, "supported");
    if (r.status !== "supported") return;
    assert.equal(r.candidate.type, "ashby");
    assert.equal(r.candidate.slug, "docker");
    assert.equal(r.candidate.baseUrl, "https://jobs.ashbyhq.com/docker");
  });

  test("detects lever listing URL on jobs.lever.co", () => {
    const r = inferAtsCandidate(
      "https://jobs.lever.co/stripe/abcdef-1234-5678",
    );
    assert.equal(r.status, "supported");
    if (r.status !== "supported") return;
    assert.equal(r.candidate.type, "lever");
    assert.equal(r.candidate.slug, "stripe");
  });

  test("detects workable apply.workable.com listing URL", () => {
    const r = inferAtsCandidate(
      "https://apply.workable.com/capgemini-insurance/j/82325b012e",
    );
    assert.equal(r.status, "supported");
    if (r.status !== "supported") return;
    assert.equal(r.candidate.type, "workable");
    assert.equal(r.candidate.slug, "capgemini-insurance");
  });

  test("detects bamboohr and normalizes", () => {
    const r = inferAtsCandidate("https://foocorp.bamboohr.com/careers/123");
    assert.equal(r.status, "supported");
    if (r.status !== "supported") return;
    assert.equal(r.candidate.slug, "foocorp");
    assert.equal(r.candidate.baseUrl, "https://foocorp.bamboohr.com/careers");
  });

  test("detects greenhouse", () => {
    const r = inferAtsCandidate("https://boards.greenhouse.io/acme/jobs/12345");
    assert.equal(r.status, "supported");
    if (r.status !== "supported") return;
    assert.equal(r.candidate.slug, "acme");
  });

  test("rejects empty URL", () => {
    const r = inferAtsCandidate("");
    assert.equal(r.status, "rejected");
    if (r.status !== "rejected") return;
    assert.equal(r.reason, "invalid_url");
  });

  test("rejects generic career page", () => {
    const r = inferAtsCandidate("https://www.acme.com/careers/engineer");
    assert.equal(r.status, "rejected");
    if (r.status !== "rejected") return;
    assert.equal(r.reason, "unknown_host");
  });

  test("rejects join.com aggregator", () => {
    const r = inferAtsCandidate("https://join.com/companies/acme/jobs/1234");
    assert.equal(r.status, "rejected");
    if (r.status !== "rejected") return;
    assert.equal(r.reason, "unknown_host");
  });

  test("rejects unsupported smartrecruiters", () => {
    const r = inferAtsCandidate(
      "https://careers.smartrecruiters.com/AcmeCorp/job-1234",
    );
    assert.equal(r.status, "rejected");
    if (r.status !== "rejected") return;
    assert.equal(r.reason, "unsupported_ats");
  });

  test("rejects ashby URL with UUID as company slug", () => {
    const r = inferAtsCandidate(
      "https://jobs.ashbyhq.com/dd69e9f1-c364-4616-af6b-5b8c6b7c06eb/extra",
    );
    assert.equal(r.status, "rejected");
    if (r.status !== "rejected") return;
    assert.equal(r.reason, "slug_extraction_failed");
  });
});

describe("canonicalization collision tracking", () => {
  test("collapses duplicate workday board keys in same sync", () => {
    const tracker = createCanonicalTracker();
    const mk = (url: string): OpenClawAtsDiscoveryEvalResult => {
      const inf = inferAtsCandidate(url);
      assert.equal(inf.status, "supported");
      if (inf.status !== "supported") throw new Error("expected supported");
      return {
        sourceUrl: url,
        detectedType: "workday",
        outcome: { status: "would_create", candidate: inf.candidate },
      };
    };
    const r1 = mk(
      "https://abb.wd3.myworkdayjobs.com/abb/job/remote/sales-specialist_jr00022498",
    );
    const r2 = mk(
      "https://abb.wd3.myworkdayjobs.com/abb/job/remote/senior-application-engineer_jr00035223",
    );
    assert.equal(trackCanonicalCandidate(tracker, r1), false);
    assert.equal(trackCanonicalCandidate(tracker, r2), true);
    assert.equal(tracker.uniqueSupportedKeys, 1);
    assert.equal(tracker.collisions, 1);
  });
});

describe("mergeAtsDiscoveryIntoSummary", () => {
  test("aggregates would_create and rejected", () => {
    const summary = createEmptyAtsDiscoverySummary();
    const supported: OpenClawAtsDiscoveryEvalResult = {
      sourceUrl: "https://jobs.lever.co/a/1",
      detectedType: "lever",
      outcome: {
        status: "would_create",
        candidate: { type: "lever", slug: "a", baseUrl: "https://jobs.lever.co/a", crawlToken: "a" },
      },
    };
    const rejected: OpenClawAtsDiscoveryEvalResult = {
      sourceUrl: "https://random.com/x",
      detectedType: null,
      outcome: { status: "rejected", reason: "unknown_host" },
    };
    mergeAtsDiscoveryIntoSummary(summary, supported);
    mergeAtsDiscoveryIntoSummary(summary, rejected);
    assert.equal(summary.evaluated, 2);
    assert.equal(summary.would_create, 1);
    assert.equal(summary.rejected, 1);
  });
});

describe("extractOpenClawDiscoverySlug", () => {
  test("workday slug does not contain job req id", () => {
    const slug = extractOpenClawDiscoverySlug(
      "https://abb.wd3.myworkdayjobs.com/abb/job/remote/sales-specialist_jr00022498",
      "workday",
    );
    assert.ok(slug);
    assert.ok(!slug!.includes("sales-specialist"));
    assert.ok(!slug!.includes("jr00022498"));
  });
});
