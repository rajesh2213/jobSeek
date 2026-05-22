import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inferRemote } from "../../../../src/modules/ats/ats.interface.js";

describe("inferRemote", () => {
  it("detects standard remote phrases", () => {
    assert.equal(inferRemote("Remote - Europe"), true);
    assert.equal(inferRemote("100% remote"), true);
    assert.equal(inferRemote("work from home"), true);
    assert.equal(inferRemote("work-from-home"), true);
    assert.equal(inferRemote("WFH"), true);
  });

  it("detects work at home and work-at-home", () => {
    assert.equal(inferRemote("Work at Home"), true);
    assert.equal(inferRemote("work-at-home"), true);
    assert.equal(
      inferRemote(
        "https://evolent.wd1.myworkdayjobs.com/external/job/work-at-home/analyst_jr-1",
      ),
      true,
    );
  });

  it("detects telecommute", () => {
    assert.equal(inferRemote("Telecommute eligible"), true);
  });

  it("returns false for on-site locations", () => {
    assert.equal(inferRemote("Barcelona (ES)"), false);
    assert.equal(inferRemote("New York, NY"), false);
  });
});
