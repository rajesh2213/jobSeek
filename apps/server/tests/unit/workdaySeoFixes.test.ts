import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  shouldBypassHashCacheForDescriptionRecovery,
} from "../../src/utils/workdayHashCacheRecovery.js";
import { isWorkdayPoisonedJob } from "../../src/modules/ats/workday/workdayPoisoned.js";
import { computeWorkdayAdaptiveFetchTimeoutMs } from "../../src/modules/ats/workday/workdayAdaptiveTimeout.js";
import { jobPartitionCount } from "../../../client/lib/sitemap/generate.ts";

describe("workdayHashCacheRecovery", () => {
  it("bypasses hash cache when existing description empty and incoming has text", () => {
    assert.equal(shouldBypassHashCacheForDescriptionRecovery("", "Full job description here"), true);
    assert.equal(shouldBypassHashCacheForDescriptionRecovery(null, "Incoming"), true);
    assert.equal(shouldBypassHashCacheForDescriptionRecovery("Existing text", "Incoming"), false);
    assert.equal(shouldBypassHashCacheForDescriptionRecovery("", ""), false);
  });
});

describe("isWorkdayPoisonedJob", () => {
  it("detects root-path URL with empty description", () => {
    assert.equal(
      isWorkdayPoisonedJob({
        source: "workday",
        description: "",
        sourceUrl: "https://acme.wd5.myworkdayjobs.com/job/Eng_JR1",
      }),
      true,
    );
    assert.equal(
      isWorkdayPoisonedJob({
        source: "workday",
        description: "Has body",
        sourceUrl: "https://acme.wd5.myworkdayjobs.com/job/Eng_JR1",
      }),
      true,
    );
    assert.equal(
      isWorkdayPoisonedJob({
        source: "workday",
        description: "Has body",
        sourceUrl: "https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Eng_JR1",
      }),
      false,
    );
  });
});

describe("computeWorkdayAdaptiveFetchTimeoutMs", () => {
  it("scales timeout with board size", () => {
    assert.ok(computeWorkdayAdaptiveFetchTimeoutMs(100) >= 120_000);
    assert.ok(computeWorkdayAdaptiveFetchTimeoutMs(400) >= 180_000);
    assert.ok(computeWorkdayAdaptiveFetchTimeoutMs(800) >= 300_000);
    assert.ok(computeWorkdayAdaptiveFetchTimeoutMs(2000) >= 600_000);
  });
});

describe("jobPartitionCount / robots alignment", () => {
  it("emits only partitions needed for actual job count", () => {
    assert.equal(jobPartitionCount(0), 0);
    assert.equal(jobPartitionCount(1), 1);
    assert.equal(jobPartitionCount(2000), 1);
    assert.equal(jobPartitionCount(2001), 2);
    assert.equal(jobPartitionCount(20394), 11);
    assert.equal(jobPartitionCount(25000), 13);
    assert.notEqual(jobPartitionCount(20394), jobPartitionCount(25000));
  });
});
