import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeJobUrl } from "../../../src/utils/normalizeJobUrl.js";

describe("normalizeJobUrl", () => {
  it("preserves gh_jid on custom-domain Greenhouse listing URLs", () => {
    const a = normalizeJobUrl("https://navan.com/careers/openings?gh_jid=7743126");
    const b = normalizeJobUrl("https://navan.com/careers/openings?gh_jid=6906952&utm_source=foo");
    assert.equal(a, "https://navan.com/careers/openings?gh_jid=7743126");
    assert.equal(b, "https://navan.com/careers/openings?gh_jid=6906952");
    assert.notEqual(a, b);
  });

  it("leaves job-boards.greenhouse.io path URLs unchanged aside from casing", () => {
    const url = normalizeJobUrl(
      "https://job-boards.greenhouse.io/postman/jobs/6340592003?utm_campaign=abc",
    );
    assert.equal(url, "https://job-boards.greenhouse.io/postman/jobs/6340592003");
  });

  it("strips hash and unrelated query params", () => {
    const url = normalizeJobUrl(
      "https://sendbird.com/careers?gh_jid=8276676002&ref=linkedin#apply",
    );
    assert.equal(url, "https://sendbird.com/careers?gh_jid=8276676002");
  });

  it("handles heuristic fallback with gh_jid", () => {
    const url = normalizeJobUrl("not-a-valid-url?gh_jid=12345&x=1");
    assert.equal(url, "not-a-valid-url?gh_jid=12345");
  });

  it("collapses duplicate slashes and trims trailing slash", () => {
    const url = normalizeJobUrl("https://Example.com/foo//bar/?gh_jid=9");
    assert.equal(url, "https://example.com/foo/bar?gh_jid=9");
  });
});
