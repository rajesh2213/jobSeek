import assert from "node:assert/strict";
import { describe, it, beforeEach, mock } from "node:test";
import {
  isWorkdayPoisonedJob,
  workdayNeedsDetailRecovery,
} from "../../../../../src/modules/ats/workday/workdayPoisoned.js";
import {
  isRetryableHttpStatus,
  isRetryableWorkdayDetailFailure,
  isRetryableWorkdayRepairFailure,
} from "../../../../../src/modules/ats/workday/workdayDetailFailure.js";
import { fetchWorkdayJobDetail } from "../../../../../src/modules/ats/workday/workday.detail.js";
import {
  resetWorkdayDetailMetrics,
} from "../../../../../src/modules/ats/workday/workdayDetailMetrics.js";

describe("expanded poisoned detection", () => {
  it("flags description + invalid URL as poisoned", () => {
    assert.equal(
      isWorkdayPoisonedJob({
        source: "workday",
        description: "Has a description body",
        sourceUrl: "https://acme.wd5.myworkdayjobs.com/job/Eng_JR1",
      }),
      true,
    );
  });

  it("clears when description and URL are valid", () => {
    assert.equal(
      isWorkdayPoisonedJob({
        source: "workday",
        description: "Has a description body",
        sourceUrl: "https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Eng_JR1",
      }),
      false,
    );
  });

  it("workdayNeedsDetailRecovery respects detailEnrichment flag", () => {
    assert.equal(
      workdayNeedsDetailRecovery({
        source: "workday",
        sourceUrl: "https://acme.wd5.myworkdayjobs.com/en-US/careers/job/x",
        description: "ok",
        detailNeedsRecovery: true,
      }),
      true,
    );
  });
});

describe("HTTP 5xx retry matrix", () => {
  beforeEach(() => resetWorkdayDetailMetrics());

  it("retries 500 responses", () => {
    assert.equal(isRetryableHttpStatus(500), true);
    assert.equal(isRetryableWorkdayDetailFailure("http_other"), true);
  });

  it("does not retry 404", () => {
    assert.equal(isRetryableHttpStatus(404), false);
    assert.equal(isRetryableWorkdayDetailFailure("http_404"), false);
    assert.equal(isRetryableWorkdayRepairFailure("http_403"), false);
    assert.equal(isRetryableWorkdayRepairFailure("timeout"), true);
  });

  it("retries 503 then succeeds", async () => {
    let calls = 0;
    mock.method(globalThis, "fetch", async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("down", { status: 503 });
      }
      return new Response(
        JSON.stringify({
          jobPostingInfo: {
            jobDescriptionHtml: "<p>" + "description ".repeat(20) + "</p>",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const token = { host: "acme.wd5.myworkdayjobs.com", tenant: "acme", site: "Careers" };
    const result = await fetchWorkdayJobDetail(token, "/job/Eng_JR-1");
    assert.equal(result.ok, true);
    assert.equal(calls, 2);
    mock.restoreAll();
  });
});
