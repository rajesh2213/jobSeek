import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseWorkdayJob } from "../../../../../src/modules/ats/workday/workday.parser.js";
import type { WorkdayRawJob } from "../../../../../src/modules/ats/workday/workday.types.js";

describe("parseWorkdayJob detailNeedsRecovery", () => {
  it("propagates needsRecovery from detail enrichment metadata", () => {
    const raw: WorkdayRawJob = {
      token: { host: "acme.wd5.myworkdayjobs.com", tenant: "acme", site: "Careers" },
      job: {
        title: "Engineer",
        externalPath: "/job/Eng_JR1",
        externalUrl: "https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Eng_JR1",
      },
      detailEnrichment: {
        outcome: "failed",
        failureReason: "timeout",
        needsRecovery: true,
      },
    };
    const parsed = parseWorkdayJob(raw, "company-1");
    assert.ok(parsed);
    assert.equal(parsed!.detailNeedsRecovery, true);
  });
});
