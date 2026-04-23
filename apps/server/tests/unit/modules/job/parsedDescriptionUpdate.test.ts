import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDiscoveryWhere,
  countPopulatedSections,
  scoreParsedDescription,
  shouldReplaceParsedDescription,
} from "../../../../src/modules/job/job.repository.js";

describe("shouldReplaceParsedDescription", () => {
  it("does not downgrade when new score is worse", () => {
    assert.equal(shouldReplaceParsedDescription(5, 0), false);
  });

  it("does not overwrite when both scores are zero", () => {
    assert.equal(shouldReplaceParsedDescription(0, 0), false);
  });

  it("allows first meaningful parse when existing has no quality", () => {
    assert.equal(shouldReplaceParsedDescription(0, 3), true);
  });

  it("allows strict upgrade", () => {
    assert.equal(shouldReplaceParsedDescription(3, 5), true);
  });

  it("does not replace when scores tie and section count does not improve", () => {
    assert.equal(shouldReplaceParsedDescription(5, 5, 2, 2), false);
    assert.equal(shouldReplaceParsedDescription(5, 5), false);
  });

  it("prefers richer structure when scores tie (more populated sections)", () => {
    assert.equal(shouldReplaceParsedDescription(7, 7, 1, 3), true);
  });
});

describe("scoreParsedDescription", () => {
  it("returns 0 for null or non-object", () => {
    assert.equal(scoreParsedDescription(null), 0);
    assert.equal(scoreParsedDescription(undefined), 0);
    assert.equal(scoreParsedDescription("x"), 0);
  });

  it("weights sections and lines and caps at 100", () => {
    const long = "x".repeat(15);
    const parsed = {
      requirement: [long, long],
      responsibility: [long],
    };
    const s = scoreParsedDescription(parsed);
    assert.ok(s > 0);
    assert.ok(s <= 100);
    // 3 lines + 2 sections * 2 = 3 + 4 = 7
    assert.equal(s, 7);
  });

  it("ignores short lines and boilerplate", () => {
    const parsed = {
      requirement: ["short", "Apply", "x".repeat(13)],
    };
    const s = scoreParsedDescription(parsed);
    // one section, one qualifying line only
    assert.equal(s, 1 + 2);
  });

  it("counts lines in other at half weight to limit junk inflation", () => {
    const long = "x".repeat(15);
    const onlyOther = { other: [long, long, long] };
    const onlyReq = { requirement: [long, long, long] };
    assert.ok(scoreParsedDescription(onlyOther) < scoreParsedDescription(onlyReq));
    // 3 * 0.5 + 2 = 3.5 vs 3 + 2 = 5
    assert.equal(scoreParsedDescription(onlyOther), 3.5);
    assert.equal(scoreParsedDescription(onlyReq), 5);
  });
});

describe("countPopulatedSections", () => {
  it("counts non-empty section arrays", () => {
    const long = "x".repeat(15);
    assert.equal(
      countPopulatedSections({
        other: [long],
        requirement: [long],
      }),
      2,
    );
    assert.equal(countPopulatedSections({}), 0);
  });
});

describe("buildDiscoveryWhere status visibility", () => {
  it("adds ready-or-null status guard by default", () => {
    const where = buildDiscoveryWhere();
    assert.equal(Array.isArray(where.AND), true);
    const andList = where.AND as unknown[];
    const hasStatusGuard = andList.some((clause) => {
      const orValue = (clause as { OR?: unknown }).OR;
      if (!Array.isArray(orValue)) return false;
      return orValue.some((entry) => {
        const status = (entry as { status?: string | null }).status;
        return status === "ready" || status === null;
      });
    });
    assert.equal(hasStatusGuard, true);
  });

  it("omits status guard when includeProcessing is true", () => {
    const where = buildDiscoveryWhere({ includeProcessing: true });
    assert.equal(Array.isArray(where.AND), true);
    const andList = where.AND as unknown[];
    const hasStatusGuard = andList.some((clause) => {
      const orValue = (clause as { OR?: unknown }).OR;
      if (!Array.isArray(orValue)) return false;
      return orValue.some((entry) =>
        Object.prototype.hasOwnProperty.call(entry as object, "status"),
      );
    });
    assert.equal(hasStatusGuard, false);
  });
});
