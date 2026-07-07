import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveWorkdayDetailContext } from "../../../../../src/modules/ats/workday/workday.detail.js";

const ROOT_URL =
  "https://acme.wd5.myworkdayjobs.com/job/Engineer_JR-123";

describe("resolveWorkdayDetailContext", () => {
  it("parses modern endpoint slug host__tenant__site", () => {
    const ctx = resolveWorkdayDetailContext(ROOT_URL, {
      endpointSlug: "acme.wd5.myworkdayjobs.com__acme__External",
    });
    assert.ok(ctx);
    assert.equal(ctx!.token.site, "External");
    assert.equal(ctx!.token.tenant, "acme");
    assert.equal(ctx!.externalPath, "/job/Engineer_JR-123");
  });

  it("parses JSON atsBoardToken", () => {
    const ctx = resolveWorkdayDetailContext(ROOT_URL, {
      atsBoardToken: JSON.stringify({
        host: "acme.wd5.myworkdayjobs.com",
        tenant: "acme",
        site: "Careers",
      }),
    });
    assert.ok(ctx);
    assert.equal(ctx!.token.site, "Careers");
  });

  it("parses legacy pipe atsBoardToken", () => {
    const ctx = resolveWorkdayDetailContext(ROOT_URL, {
      atsBoardToken: "acme.wd5.myworkdayjobs.com|acme|Global",
    });
    assert.ok(ctx);
    assert.equal(ctx!.token.site, "Global");
  });

  it("defaults site when no hints", () => {
    const ctx = resolveWorkdayDetailContext(ROOT_URL, {});
    assert.ok(ctx);
    assert.equal(ctx!.token.site, "Careers");
    assert.equal(ctx!.token.tenant, "acme");
  });

  it("returns null without /job/ path", () => {
    const ctx = resolveWorkdayDetailContext("https://acme.wd5.myworkdayjobs.com/", {});
    assert.equal(ctx, null);
  });

  it("returns null when hostname is not Workday", () => {
    const ctx = resolveWorkdayDetailContext("https://example.com/job/Eng_JR1", {});
    assert.equal(ctx, null);
  });

  it("ignores partial endpoint slug token", () => {
    const ctx = resolveWorkdayDetailContext(ROOT_URL, {
      endpointSlug: "acme.wd5.myworkdayjobs.com__acme",
    });
    assert.ok(ctx);
    assert.equal(ctx!.token.tenant, "acme");
    assert.equal(ctx!.token.site, "Careers");
  });
});
