import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseWorkdayPostedAt } from "../../../../../src/modules/ats/workday/workday.parser.js";
import type { WorkdayJob } from "../../../../../src/modules/ats/workday/workday.types.js";

const COMPANY = "company-test-id";

function job(fields: Partial<WorkdayJob>): WorkdayJob {
  return { title: "Role", ...fields };
}

describe("parseWorkdayPostedAt", () => {
  it("accepts valid startDate", () => {
    const d = parseWorkdayPostedAt(job({ startDate: "2026-06-01" }), COMPANY);
    assert.ok(d);
    assert.equal(d!.toISOString().slice(0, 10), "2026-06-01");
  });

  it("rejects future startDate beyond 24h", () => {
    const future = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const iso = future.toISOString().slice(0, 10);
    const d = parseWorkdayPostedAt(job({ startDate: iso }), COMPANY);
    assert.equal(d, undefined);
  });

  it("rejects ancient startDate beyond 10 years", () => {
    const d = parseWorkdayPostedAt(job({ startDate: "2010-01-01" }), COMPANY);
    assert.equal(d, undefined);
  });

  it("rejects Posted Today human label on postedOn", () => {
    const d = parseWorkdayPostedAt(job({ postedOn: "Posted Today" }), COMPANY);
    assert.equal(d, undefined);
  });

  it("rejects Posted Yesterday human label on postedOn", () => {
    const d = parseWorkdayPostedAt(job({ postedOn: "Posted Yesterday" }), COMPANY);
    assert.equal(d, undefined);
  });

  it("accepts ISO postedOn when startDate is absent", () => {
    const d = parseWorkdayPostedAt(job({ postedOn: "2026-06-10" }), COMPANY);
    assert.ok(d);
    assert.equal(d!.toISOString().slice(0, 10), "2026-06-10");
  });

  it("prefers startDate over postedOn", () => {
    const d = parseWorkdayPostedAt(
      job({ startDate: "2026-05-20", postedOn: "2026-06-10" }),
      COMPANY,
    );
    assert.ok(d);
    assert.equal(d!.toISOString().slice(0, 10), "2026-05-20");
  });
});
