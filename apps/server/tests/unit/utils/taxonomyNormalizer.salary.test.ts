import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractSalaryMinUsd } from "../../../src/utils/taxonomyNormalizer.js";

describe("extractSalaryMinUsd — false positive rejection", () => {
  it("rejects $500K+ ACV (deal size)", () => {
    assert.equal(
      extractSalaryMinUsd(
        "7–10+ years closing complex SaaS/infrastructure deals with $500K+ ACV",
      ),
      null,
    );
  });

  it("rejects $800k+ annual quotas", () => {
    assert.equal(
      extractSalaryMinUsd("Proven track record hitting $800k+ annual quotas"),
      null,
    );
  });

  it("rejects $500K+ ARR", () => {
    assert.equal(
      extractSalaryMinUsd("Experience selling into $500K+ ARR accounts"),
      null,
    );
  });

  it("rejects $300k budget", () => {
    assert.equal(
      extractSalaryMinUsd("Manage a $300k budget for marketing"),
      null,
    );
  });

  it("rejects $500K+ major gifts", () => {
    assert.equal(
      extractSalaryMinUsd(
        "Secure $500K+ major gifts from institutional donors",
      ),
      null,
    );
  });

  it("rejects $500k to $400M (project cost range)", () => {
    assert.equal(
      extractSalaryMinUsd("Projects ranging from $500k to $400M in value"),
      null,
    );
  });

  it("rejects $500K+ deals (after-context)", () => {
    assert.equal(
      extractSalaryMinUsd("Experience with $500K+ deals in enterprise SaaS"),
      null,
    );
  });

  it("rejects closing $500K+ (before-context)", () => {
    assert.equal(
      extractSalaryMinUsd("Track record of closing $500K+ enterprise contracts"),
      null,
    );
  });

  it("rejects $200K pipeline", () => {
    assert.equal(
      extractSalaryMinUsd("Build a $200K pipeline within Q1"),
      null,
    );
  });

  it("rejects $500K revenue", () => {
    assert.equal(
      extractSalaryMinUsd("Generated $500K revenue in first year"),
      null,
    );
  });

  it("rejects $100K MRR", () => {
    assert.equal(
      extractSalaryMinUsd("Grow accounts to $100K MRR"),
      null,
    );
  });

  it("rejects selling $300K (before-context)", () => {
    assert.equal(
      extractSalaryMinUsd("Experience selling $300K enterprise licenses"),
      null,
    );
  });

  it("rejects raising $500K (before-context)", () => {
    assert.equal(
      extractSalaryMinUsd("Led a team raising $500K for the annual fund"),
      null,
    );
  });

  it("rejects $500K portfolio", () => {
    assert.equal(
      extractSalaryMinUsd("Oversee a $500K portfolio of investments"),
      null,
    );
  });

  it("rejects $300K spend", () => {
    assert.equal(
      extractSalaryMinUsd("Manage $300K spend across digital channels"),
      null,
    );
  });

  it("rejects $500K loan", () => {
    assert.equal(
      extractSalaryMinUsd("Process $500K loan applications"),
      null,
    );
  });

  it("rejects $200K worth of", () => {
    assert.equal(
      extractSalaryMinUsd("Delivered $200K worth of consulting services"),
      null,
    );
  });

  it("rejects $250K per deal", () => {
    assert.equal(
      extractSalaryMinUsd("Average $250K per deal in enterprise segment"),
      null,
    );
  });

  it("rejects $500K target", () => {
    assert.equal(
      extractSalaryMinUsd("Achieve $500K target for Q3 sales"),
      null,
    );
  });

  it("rejects $100K+ annual revenue", () => {
    assert.equal(
      extractSalaryMinUsd("Grow accounts to $100K+ annual revenue"),
      null,
    );
  });

  it("rejects $300K total revenue", () => {
    assert.equal(
      extractSalaryMinUsd("Achieved $300K total revenue from new accounts"),
      null,
    );
  });

  it("rejects $500K contract value", () => {
    assert.equal(
      extractSalaryMinUsd("Negotiate $500K contract values with clients"),
      null,
    );
  });

  it("rejects amounts under $10K", () => {
    assert.equal(extractSalaryMinUsd("Tools cost $5k per month"), null);
  });

  it("rejects sold $400K (before-context)", () => {
    assert.equal(
      extractSalaryMinUsd("Have sold $400K software packages"),
      null,
    );
  });
});

describe("extractSalaryMinUsd — true positive preservation", () => {
  it("extracts $150K from plain mention", () => {
    assert.equal(extractSalaryMinUsd("Salary is $150K per year"), 150_000);
  });

  it("extracts $120K from range ($120K - $180K)", () => {
    assert.equal(
      extractSalaryMinUsd("Compensation: $120K - $180K annually"),
      120_000,
    );
  });

  it("extracts $200K from OTE mention", () => {
    assert.equal(extractSalaryMinUsd("OTE: $200K"), 200_000);
  });

  it("extracts $130K from base salary", () => {
    assert.equal(
      extractSalaryMinUsd("Base salary of $130K plus equity"),
      130_000,
    );
  });

  it("extracts $100K from pay range", () => {
    assert.equal(
      extractSalaryMinUsd("Pay range: $100K – $140K depending on experience"),
      100_000,
    );
  });

  it("extracts $90K from salary with space after dollar", () => {
    assert.equal(extractSalaryMinUsd("Starting at $ 90k"), 90_000);
  });

  it("extracts $250K from total compensation", () => {
    assert.equal(
      extractSalaryMinUsd("Total compensation up to $250K"),
      250_000,
    );
  });

  it("extracts first valid salary when description has both non-salary and salary", () => {
    assert.equal(
      extractSalaryMinUsd(
        "Experience closing $500K+ ACV deals. Salary: $150K - $200K",
      ),
      150_000,
    );
  });

  it("returns null when no dollar-K pattern exists", () => {
    assert.equal(
      extractSalaryMinUsd("This role pays $120,000 annually"),
      null,
    );
  });

  it("returns null for empty string", () => {
    assert.equal(extractSalaryMinUsd(""), null);
  });

  it("extracts $180K from compensation section", () => {
    assert.equal(
      extractSalaryMinUsd("Compensation\n$180K - $220K base salary"),
      180_000,
    );
  });

  it("extracts $500K when it IS salary (no business-metric context)", () => {
    assert.equal(
      extractSalaryMinUsd("Base salary: $500K for this executive role"),
      500_000,
    );
  });
});
