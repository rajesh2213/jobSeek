import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseWorkdayListingSlug } from "../../../../../src/modules/ats/workday/workday.parser.js";

describe("parseWorkdayListingSlug", () => {
  it("parses India---City", () => {
    const r = parseWorkdayListingSlug(
      "https://acme.wd1.myworkdayjobs.com/Careers/job/India---Hyderabad/SWE_123",
    );
    assert.equal(r.city, "Hyderabad");
    assert.equal(r.state, null);
    assert.equal(r.displayLine, undefined);
  });

  it("parses Ireland---Dublin with display line", () => {
    const r = parseWorkdayListingSlug(
      "https://salesforce.wd12.myworkdayjobs.com/Slack/job/Ireland---Dublin/SMB_JR",
    );
    assert.equal(r.city, "Dublin");
    assert.equal(r.state, null);
    assert.equal(r.displayLine, "Dublin, Ireland");
  });

  it("parses Washington---Seattle as US state + city", () => {
    const r = parseWorkdayListingSlug(
      "https://salesforce.wd12.myworkdayjobs.com/Slack/job/Washington---Seattle/Senior_JR",
    );
    assert.equal(r.city, "Seattle");
    assert.equal(r.state, "Washington");
    assert.equal(r.displayLine, undefined);
  });

  it("parses City-ST abbreviation slug", () => {
    const r = parseWorkdayListingSlug(
      "https://acme.wd1.myworkdayjobs.com/Careers/job/Itasca-IL/Role_1",
    );
    assert.equal(r.city, "Itasca");
    assert.equal(r.state, "Illinois");
  });
});
