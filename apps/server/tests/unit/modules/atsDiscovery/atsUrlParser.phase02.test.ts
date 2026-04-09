import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeAtsUrl } from "../../../../src/utils/normalizeAtsUrl.js";
import {
  asciiSafeLower,
  buildWorkdaySlug,
  parseAtsUrlToEndpoint,
  parseWorkdayBoardToken,
  parseWorkdaySlug,
} from "../../../../src/modules/atsDiscovery/atsUrlParser.js";
import { dedupeRegistrationsByTypeSlug } from "../../../../src/modules/atsEndpoint/atsEndpoint.service.js";

describe("normalizeAtsUrl", () => {
  it("is idempotent", () => {
    const samples = [
      "https://BOARDS.greenhouse.io/Acme/?x=1#frag",
      "https://jobs.lever.co/FooBar/jobs",
      "apply.workable.com/WidgetCo",
    ];
    for (const s of samples) {
      const once = normalizeAtsUrl(s);
      const twice = normalizeAtsUrl(once);
      assert.equal(twice, once);
    }
  });

  it("strips query and fragment", () => {
    assert.equal(
      normalizeAtsUrl("HTTPS://HOST.COM/path?a=1#b"),
      "https://host.com/path",
    );
  });
});

describe("workday slug", () => {
  it("round-trips encode/decode", () => {
    const parts = {
      host: "acme.wd5.myworkdayjobs.com",
      tenant: "acme",
      site: "careers",
    };
    const slug = buildWorkdaySlug(parts);
    assert.match(slug, /^[a-z0-9%._~-]+(__[a-z0-9%._~-]+){2}$/);
    const back = parseWorkdaySlug(slug);
    assert.deepEqual(back, parts);
  });

  it("parseWorkdayBoardToken accepts JSON", () => {
    const j = JSON.stringify({
      host: "x.wd1.myworkdayjobs.com",
      tenant: "x",
      site: "External",
    });
    const t = parseWorkdayBoardToken(j);
    assert.equal(t?.tenant, "x");
  });
});

describe("parseAtsUrlToEndpoint", () => {
  it("normalizes greenhouse board slug", () => {
    const r = parseAtsUrlToEndpoint(
      "https://boards.greenhouse.io/MYCO/jobs/123?q=1",
    );
    assert.equal(r?.type, "greenhouse");
    assert.equal(r?.slug, "myco");
  });

  it("parses workday listing URL", () => {
    const u = "https://ACME.wd1.myworkdayjobs.com/Careers?q=1";
    const r = parseAtsUrlToEndpoint(u);
    assert.equal(r?.type, "workday");
    assert.ok(r?.slug.includes("__"));
    assert.ok(r?.crawlToken.includes("acme"));
  });

  it("maps workday CXS job posting URL to default Careers site (not job title segment)", () => {
    const u =
      "https://kla.wd1.myworkdayjobs.com/job/Manassas-VA/Customer-Support-Engineer_2532470";
    const r = parseAtsUrlToEndpoint(u);
    assert.equal(r?.type, "workday");
    assert.ok(r?.crawlToken.includes("Careers"));
    assert.ok(!r?.crawlToken.includes("Customer-Support"));
  });
});

describe("asciiSafeLower", () => {
  it("strips non-ASCII", () => {
    assert.equal(asciiSafeLower("Café-Co"), "cafe-co");
  });
});

describe("dedupeRegistrationsByTypeSlug", () => {
  it("keeps one registration per type+slug", () => {
    const a = dedupeRegistrationsByTypeSlug([
      {
        type: "greenhouse",
        slug: "x",
        baseUrl: "https://boards.greenhouse.io/x",
        crawlToken: "x",
      },
      {
        type: "greenhouse",
        slug: "x",
        baseUrl: "https://boards.greenhouse.io/x",
        crawlToken: "x",
      },
      {
        type: "lever",
        slug: "y",
        baseUrl: "https://jobs.lever.co/y",
        crawlToken: "y",
      },
    ]);
    assert.equal(a.length, 2);
  });
});
