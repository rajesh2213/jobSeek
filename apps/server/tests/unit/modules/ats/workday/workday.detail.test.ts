import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import {
  enrichWorkdayRawJobWithDetail,
  fetchWorkdayJobDetail,
} from "../../../../../src/modules/ats/workday/workday.detail.js";
import {
  resetWorkdayDetailMetrics,
  getWorkdayDetailMetricsSnapshot,
} from "../../../../../src/modules/ats/workday/workdayDetailMetrics.js";
import type { WorkdayRawJob } from "../../../../../src/modules/ats/workday/workday.types.js";

const token = { host: "acme.wd5.myworkdayjobs.com", tenant: "acme", site: "Careers" };

function rawJob(overrides: Partial<WorkdayRawJob["job"]> = {}): WorkdayRawJob {
  return {
    token,
    job: {
      title: "Engineer",
      externalPath: "/job/Engineer_JR-123",
      ...overrides,
    },
  };
}

describe("workday detail enrichment", () => {
  beforeEach(() => resetWorkdayDetailMetrics());
  afterEach(() => mock.restoreAll());

  it("skips fetch when description already substantive", async () => {
    const raw = rawJob({ jobDescriptionHtml: "<p>" + "x".repeat(100) + "</p>" });
    const out = await enrichWorkdayRawJobWithDetail(raw);
    assert.equal(out.detailEnrichment?.outcome, "skipped_has_description");
  });

  it("retries 429 then succeeds", async () => {
    let calls = 0;
    mock.method(globalThis, "fetch", async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("rate limited", { status: 429 });
      }
      return new Response(
        JSON.stringify({
          jobPostingInfo: {
            jobDescriptionHtml: "<p>" + "description ".repeat(20) + "</p>",
            title: "Engineer",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const result = await fetchWorkdayJobDetail(token, "/job/Engineer_JR-123");
    assert.equal(result.ok, true);
    assert.equal(calls, 2);
    const m = getWorkdayDetailMetricsSnapshot();
    assert.ok(m.workday_detail_retry_total >= 1);
    assert.ok(m.workday_detail_success_total >= 1);
  });

  it("does not retry 404", async () => {
    let calls = 0;
    mock.method(globalThis, "fetch", async () => {
      calls += 1;
      return new Response("missing", { status: 404 });
    });

    const result = await fetchWorkdayJobDetail(token, "/job/Missing_JR-1");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "http_404");
    assert.equal(calls, 1);
    const m = getWorkdayDetailMetricsSnapshot();
    assert.ok(m.workday_detail_failure_total >= 1);
  });

  it("marks recoverable on ultimate failure", async () => {
    mock.method(globalThis, "fetch", async () => {
      return new Response("missing", { status: 404 });
    });
    const out = await enrichWorkdayRawJobWithDetail(rawJob());
    assert.equal(out.detailEnrichment?.outcome, "failed");
    assert.equal(out.detailEnrichment?.needsRecovery, true);
  });
});
