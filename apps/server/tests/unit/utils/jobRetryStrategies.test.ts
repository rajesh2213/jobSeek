import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyRetryStrategies } from "../../../src/utils/jobRetryStrategies.js";

const primary = {
  title: "x",
  description: "y".repeat(50),
  location: undefined as string | undefined,
};

describe("applyRetryStrategies", () => {
  it("returns null when initialScore is below 20", () => {
    const r = applyRetryStrategies({
      html: "<html></html>",
      sourceUrl: "https://example.com/jobs/1",
      previousReasons: ["location_missing"],
      initialScore: 10,
      primary,
    });
    assert.equal(r, null);
  });

  it("selects jsonld_only when json_ld_jobposting is present", () => {
    const html = `
      <script type="application/ld+json">
        {"@type":"JobPosting","title":"Engineer","description":"${"z".repeat(400)}","jobLocation":{"address":{"addressLocality":"Dublin","addressCountry":"IE"}}}
      </script>
    `;
    const r = applyRetryStrategies({
      html,
      sourceUrl: "https://example.com/jobs/apply-1",
      previousReasons: ["json_ld_jobposting", "junk_title"],
      initialScore: 25,
      primary,
    });
    assert.ok(r);
    assert.equal(r!.strategyUsed, "jsonld_only");
    assert.ok(r!.title?.includes("Engineer"));
  });

  it("selects relaxed_title for title reasons", () => {
    const html = `
      <head>
        <meta property="og:title" content="Product Designer | Acme Careers" />
        <title>Product Designer | Acme Careers</title>
      </head>
    `;
    const r = applyRetryStrategies({
      html,
      sourceUrl: "https://example.com/jobs/apply-1",
      previousReasons: ["junk_title"],
      initialScore: 30,
      primary,
    });
    assert.ok(r);
    assert.equal(r!.strategyUsed, "relaxed_title");
    assert.ok(r!.title!.length >= 5);
  });

  it("selects main_content for description reasons", () => {
    const html = `
      <main><p>${"Long job description text. ".repeat(30)}</p></main>
    `;
    const r = applyRetryStrategies({
      html,
      sourceUrl: "https://example.com/jobs/apply-1",
      previousReasons: ["description_too_short"],
      initialScore: 35,
      primary,
    });
    assert.ok(r);
    assert.equal(r!.strategyUsed, "main_content");
    assert.ok((r!.description?.length ?? 0) >= 120);
  });

  it("selects location_fallback when only location is missing", () => {
    const html = `
      <body>Acme • United States of America</body>
    `;
    const r = applyRetryStrategies({
      html,
      sourceUrl: "https://example.com/jobs/apply-1",
      previousReasons: ["location_missing"],
      initialScore: 45,
      primary: { ...primary, description: "d".repeat(400) },
    });
    assert.ok(r);
    assert.equal(r!.strategyUsed, "location_fallback");
    assert.ok(r!.location?.includes("•"));
  });
});
