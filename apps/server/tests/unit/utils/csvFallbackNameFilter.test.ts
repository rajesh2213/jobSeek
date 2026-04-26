import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldRejectForCsvFallback } from "../../../src/utils/csvFallbackNameFilter.js";

describe("shouldRejectForCsvFallback", () => {
  it("accepts normal company names", () => {
    assert.equal(shouldRejectForCsvFallback("Acme Corporation").reject, false);
    assert.equal(shouldRejectForCsvFallback("Calm Health Labs").reject, false);
  });

  it("rejects blocked keywords and obvious fallback placeholders", () => {
    assert.equal(shouldRejectForCsvFallback("Stealth Startup").reject, true);
    assert.equal(shouldRejectForCsvFallback("We are hiring").reject, true);
    assert.equal(shouldRejectForCsvFallback("Confidential Client").reject, true);
    assert.equal(shouldRejectForCsvFallback("Anonymous Team").reject, true);
    assert.equal(shouldRejectForCsvFallback("Hiring Team").reject, true);
  });

  it("rejects length out of v1 range", () => {
    assert.equal(shouldRejectForCsvFallback("ab").reject, true);
    if (!shouldRejectForCsvFallback("a".repeat(81)).reject) {
      assert.fail("expected reject for >80 chars");
    }
    assert.equal(shouldRejectForCsvFallback("abc").reject, false);
  });

  it("rejects when no letters", () => {
    assert.equal(shouldRejectForCsvFallback("12345").reject, true);
  });

  it("rejects no-vowel and generic/junk patterns", () => {
    assert.equal(shouldRejectForCsvFallback("Xyz Qwr").reject, true);
    assert.equal(shouldRejectForCsvFallback("Company XYZ").reject, true);
    assert.equal(shouldRejectForCsvFallback("Test123").reject, true);
  });

  it("strips edge punctuation for blocklist keyword", () => {
    assert.equal(shouldRejectForCsvFallback("Hiring,").reject, true);
  });
});
