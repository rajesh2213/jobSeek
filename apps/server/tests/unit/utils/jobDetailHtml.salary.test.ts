import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractSalaryFromJobPostingJsonLd } from "../../../src/utils/jobDetailHtml.js";

function wrap(jsonLd: object): string {
  return `<html><head><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head><body></body></html>`;
}

describe("extractSalaryFromJobPostingJsonLd — shape tolerance", () => {
  it("Variant A: baseSalary.value.minValue / maxValue (standard)", () => {
    const html = wrap({
      "@type": "JobPosting",
      title: "Engineer",
      baseSalary: {
        "@type": "MonetaryAmount",
        currency: "USD",
        value: {
          "@type": "QuantitativeValue",
          minValue: 120000,
          maxValue: 180000,
          unitText: "YEAR",
        },
      },
    });
    const result = extractSalaryFromJobPostingJsonLd(html);
    assert.deepEqual(result, { minValue: 120000, maxValue: 180000, currency: "USD" });
  });

  it("Variant B: baseSalary.minValue / maxValue (flattened)", () => {
    const html = wrap({
      "@type": "JobPosting",
      title: "Engineer",
      baseSalary: {
        currency: "USD",
        minValue: 100000,
        maxValue: 150000,
        unitText: "YEAR",
      },
    });
    const result = extractSalaryFromJobPostingJsonLd(html);
    assert.deepEqual(result, { minValue: 100000, maxValue: 150000, currency: "USD" });
  });

  it("Variant C: baseSalary.value.value (single value)", () => {
    const html = wrap({
      "@type": "JobPosting",
      title: "Designer",
      baseSalary: {
        currency: "USD",
        value: { value: 95000, unitText: "YEAR" },
      },
    });
    const result = extractSalaryFromJobPostingJsonLd(html);
    assert.deepEqual(result, { minValue: 95000, maxValue: null, currency: "USD" });
  });

  it("Variant D: baseSalary.value as number", () => {
    const html = wrap({
      "@type": "JobPosting",
      title: "Analyst",
      baseSalary: {
        currency: "USD",
        value: 85000,
        unitText: "YEAR",
      },
    });
    const result = extractSalaryFromJobPostingJsonLd(html);
    assert.deepEqual(result, { minValue: 85000, maxValue: null, currency: "USD" });
  });

  it("Variant E: estimatedSalary fallback", () => {
    const html = wrap({
      "@type": "JobPosting",
      title: "Manager",
      estimatedSalary: {
        currency: "USD",
        value: {
          minValue: 130000,
          maxValue: 160000,
          unitText: "YEAR",
        },
      },
    });
    const result = extractSalaryFromJobPostingJsonLd(html);
    assert.deepEqual(result, { minValue: 130000, maxValue: 160000, currency: "USD" });
  });

  it("Variant F: @graph-nested JobPosting", () => {
    const html = wrap({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "Organization", name: "Acme" },
        {
          "@type": "JobPosting",
          title: "Dev",
          baseSalary: {
            currency: "USD",
            value: { minValue: 110000, maxValue: 140000, unitText: "YEAR" },
          },
        },
      ],
    });
    const result = extractSalaryFromJobPostingJsonLd(html);
    assert.deepEqual(result, { minValue: 110000, maxValue: 140000, currency: "USD" });
  });

  it("Variant G: array-wrapped baseSalary.value", () => {
    const html = wrap({
      "@type": "JobPosting",
      title: "Engineer",
      baseSalary: {
        currency: "USD",
        value: [
          { minValue: 100000, maxValue: 130000, unitText: "YEAR" },
        ],
      },
    });
    const result = extractSalaryFromJobPostingJsonLd(html);
    assert.deepEqual(result, { minValue: 100000, maxValue: 130000, currency: "USD" });
  });

  it("baseSalary as array", () => {
    const html = wrap({
      "@type": "JobPosting",
      title: "Engineer",
      baseSalary: [
        {
          currency: "USD",
          value: { minValue: 90000, maxValue: 120000, unitText: "YEAR" },
        },
      ],
    });
    const result = extractSalaryFromJobPostingJsonLd(html);
    assert.deepEqual(result, { minValue: 90000, maxValue: 120000, currency: "USD" });
  });

  it("string number values are coerced", () => {
    const html = wrap({
      "@type": "JobPosting",
      baseSalary: {
        currency: "USD",
        value: { minValue: "75000", maxValue: "100000", unitText: "YEAR" },
      },
    });
    const result = extractSalaryFromJobPostingJsonLd(html);
    assert.deepEqual(result, { minValue: 75000, maxValue: 100000, currency: "USD" });
  });
});

describe("extractSalaryFromJobPostingJsonLd — unit normalization", () => {
  it("hourly $50/hr normalizes to $104,000 annual", () => {
    const html = wrap({
      "@type": "JobPosting",
      baseSalary: {
        currency: "USD",
        value: { minValue: 50, maxValue: 75, unitText: "HOUR" },
      },
    });
    const result = extractSalaryFromJobPostingJsonLd(html);
    assert.equal(result?.minValue, 104000);
    assert.equal(result?.maxValue, 156000);
  });

  it("monthly $10,000/mo normalizes to $120,000 annual", () => {
    const html = wrap({
      "@type": "JobPosting",
      baseSalary: {
        currency: "USD",
        value: { minValue: 10000, maxValue: 15000, unitText: "MONTH" },
      },
    });
    const result = extractSalaryFromJobPostingJsonLd(html);
    assert.equal(result?.minValue, 120000);
    assert.equal(result?.maxValue, 180000);
  });

  it("weekly normalizes to annual", () => {
    const html = wrap({
      "@type": "JobPosting",
      baseSalary: {
        currency: "USD",
        value: { minValue: 2000, unitText: "WEEK" },
      },
    });
    const result = extractSalaryFromJobPostingJsonLd(html);
    assert.equal(result?.minValue, 104000);
    assert.equal(result?.maxValue, null);
  });
});

describe("extractSalaryFromJobPostingJsonLd — sanity bounds", () => {
  it("hourly $500/hr is rejected (exceeds $500 max)", () => {
    const html = wrap({
      "@type": "JobPosting",
      baseSalary: {
        currency: "USD",
        value: { minValue: 500, unitText: "HOUR" },
      },
    });
    assert.equal(extractSalaryFromJobPostingJsonLd(html), null);
  });

  it("hourly $5/hr is rejected (below $7 min)", () => {
    const html = wrap({
      "@type": "JobPosting",
      baseSalary: {
        currency: "USD",
        value: { minValue: 5, unitText: "HOUR" },
      },
    });
    assert.equal(extractSalaryFromJobPostingJsonLd(html), null);
  });

  it("annual $5,000 is rejected (below $10,000 min)", () => {
    const html = wrap({
      "@type": "JobPosting",
      baseSalary: {
        currency: "USD",
        value: { minValue: 5000, unitText: "YEAR" },
      },
    });
    assert.equal(extractSalaryFromJobPostingJsonLd(html), null);
  });

  it("annual $3,000,000 is rejected (above $2,000,000 max)", () => {
    const html = wrap({
      "@type": "JobPosting",
      baseSalary: {
        currency: "USD",
        value: { minValue: 3000000, unitText: "YEAR" },
      },
    });
    assert.equal(extractSalaryFromJobPostingJsonLd(html), null);
  });

  it("min > max gets swapped", () => {
    const html = wrap({
      "@type": "JobPosting",
      baseSalary: {
        currency: "USD",
        value: { minValue: 180000, maxValue: 120000, unitText: "YEAR" },
      },
    });
    const result = extractSalaryFromJobPostingJsonLd(html);
    assert.deepEqual(result, { minValue: 120000, maxValue: 180000, currency: "USD" });
  });

  it("min == max becomes single value (maxValue null)", () => {
    const html = wrap({
      "@type": "JobPosting",
      baseSalary: {
        currency: "USD",
        value: { minValue: 100000, maxValue: 100000, unitText: "YEAR" },
      },
    });
    const result = extractSalaryFromJobPostingJsonLd(html);
    assert.deepEqual(result, { minValue: 100000, maxValue: null, currency: "USD" });
  });
});

describe("extractSalaryFromJobPostingJsonLd — rejection cases", () => {
  it("non-USD currency returns null", () => {
    const html = wrap({
      "@type": "JobPosting",
      baseSalary: {
        currency: "GBP",
        value: { minValue: 80000, maxValue: 100000, unitText: "YEAR" },
      },
    });
    assert.equal(extractSalaryFromJobPostingJsonLd(html), null);
  });

  it("missing baseSalary returns null", () => {
    const html = wrap({
      "@type": "JobPosting",
      title: "Engineer",
    });
    assert.equal(extractSalaryFromJobPostingJsonLd(html), null);
  });

  it("malformed JSON-LD returns null", () => {
    const html = `<html><head><script type="application/ld+json">{not valid json</script></head></html>`;
    assert.equal(extractSalaryFromJobPostingJsonLd(html), null);
  });

  it("no JobPosting node returns null", () => {
    const html = wrap({
      "@type": "Organization",
      name: "Acme",
    });
    assert.equal(extractSalaryFromJobPostingJsonLd(html), null);
  });

  it("empty HTML returns null", () => {
    assert.equal(extractSalaryFromJobPostingJsonLd(""), null);
  });

  it("unknown unitText returns null", () => {
    const html = wrap({
      "@type": "JobPosting",
      baseSalary: {
        currency: "USD",
        value: { minValue: 100000, unitText: "DECADE" },
      },
    });
    assert.equal(extractSalaryFromJobPostingJsonLd(html), null);
  });

  it("only maxValue (no min) still returns with min set from max", () => {
    const html = wrap({
      "@type": "JobPosting",
      baseSalary: {
        currency: "USD",
        value: { maxValue: 150000, unitText: "YEAR" },
      },
    });
    const result = extractSalaryFromJobPostingJsonLd(html);
    assert.deepEqual(result, { minValue: 150000, maxValue: null, currency: "USD" });
  });
});
