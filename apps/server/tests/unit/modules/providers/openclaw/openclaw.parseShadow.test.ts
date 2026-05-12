import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateOpenClawShadowParseEligibility,
  mergeOpenClawShadowEvalIntoSummary,
  createEmptyOpenClawShadowSummary,
  openClawShadowMinDescriptionChars,
  sourceUrlHost,
} from "../../../../../src/modules/providers/providers/openclaw/openclaw.parseShadow.js";
import { computeJobContentHash } from "../../../../../src/utils/jobContentHash.js";

const now = new Date("2026-05-12T12:00:00.000Z");
const lookbackOk = new Date("2026-05-11T12:00:00.000Z");
const lookbackStale = new Date("2026-01-01T12:00:00.000Z");

function baseRow(
  overrides: Partial<Parameters<typeof evaluateOpenClawShadowParseEligibility>[0]> & {
    id?: string;
  } = {},
): NonNullable<Parameters<typeof evaluateOpenClawShadowParseEligibility>[0]> {
  const title = "Senior Software Engineer";
  const sourceUrl = "https://boards.example.com/jobs/1";
  const description = "x".repeat(openClawShadowMinDescriptionChars());
  const h = computeJobContentHash({
    title,
    description,
    applyUrl: sourceUrl,
  });
  return {
    id: overrides.id ?? "job-1",
    status: overrides.status ?? "processing",
    title: overrides.title ?? title,
    sourceUrl: overrides.sourceUrl ?? sourceUrl,
    description: overrides.description !== undefined ? overrides.description : description,
    applyUrl: overrides.applyUrl !== undefined ? overrides.applyUrl : null,
    parsedDescription:
      overrides.parsedDescription !== undefined ? overrides.parsedDescription : null,
    lastSeenAt: overrides.lastSeenAt !== undefined ? overrides.lastSeenAt : lookbackOk,
    lastProcessedAt:
      overrides.lastProcessedAt !== undefined ? overrides.lastProcessedAt : null,
    contentHash: overrides.contentHash !== undefined ? overrides.contentHash : null,
  };
}

describe("openclaw.parseShadow", () => {
  test("eligible when all processor-aligned gates pass", () => {
    const row = baseRow();
    const r = evaluateOpenClawShadowParseEligibility(row, {
      now,
      recentSeenBlocks: false,
    });
    assert.equal(r.eligible, true);
    assert.equal(r.reason, "eligible");
    assert.equal(r.processorWouldSkipParse, false);
  });

  test("ineligible: failed_status", () => {
    const r = evaluateOpenClawShadowParseEligibility(baseRow({ status: "failed" }), {
      now,
      recentSeenBlocks: false,
    });
    assert.equal(r.eligible, false);
    assert.equal(r.reason, "failed_status");
  });

  test("ineligible: existing usable parse", () => {
    const r = evaluateOpenClawShadowParseEligibility(
      baseRow({
        parsedDescription: { position: ["This is a real requirement line here"] },
      }),
      { now, recentSeenBlocks: false },
    );
    assert.equal(r.eligible, false);
    assert.equal(r.reason, "existing_usable_parse");
  });

  test("ineligible: missing_description", () => {
    const r = evaluateOpenClawShadowParseEligibility(baseRow({ description: null }), {
      now,
      recentSeenBlocks: false,
    });
    assert.equal(r.reason, "missing_description");
  });

  test("ineligible: description_too_short", () => {
    const r = evaluateOpenClawShadowParseEligibility(baseRow({ description: "short" }), {
      now,
      recentSeenBlocks: false,
    });
    assert.equal(r.reason, "description_too_short");
  });

  test("ineligible: outside_lookback_window", () => {
    const r = evaluateOpenClawShadowParseEligibility(baseRow({ lastSeenAt: lookbackStale }), {
      now,
      recentSeenBlocks: false,
    });
    assert.equal(r.reason, "outside_lookback_window");
  });

  test("ineligible: no_reprocessing_needed", () => {
    const r = evaluateOpenClawShadowParseEligibility(
      baseRow({
        lastSeenAt: lookbackOk,
        lastProcessedAt: new Date(lookbackOk.getTime() + 60_000),
      }),
      { now, recentSeenBlocks: false },
    );
    assert.equal(r.reason, "no_reprocessing_needed");
  });

  test("ineligible: content_unchanged", () => {
    const row = baseRow();
    const h = computeJobContentHash({
      title: row.title,
      description: row.description,
      applyUrl: row.applyUrl ?? row.sourceUrl,
    });
    const r = evaluateOpenClawShadowParseEligibility(row, {
      now,
      recentSeenBlocks: false,
    });
    assert.equal(r.eligible, true);
    const r2 = evaluateOpenClawShadowParseEligibility(
      baseRow({ contentHash: h }),
      { now, recentSeenBlocks: false },
    );
    assert.equal(r2.eligible, false);
    assert.equal(r2.reason, "content_unchanged");
  });

  test("ineligible: recent_seen_dedupe_window", () => {
    const r = evaluateOpenClawShadowParseEligibility(baseRow(), {
      now,
      recentSeenBlocks: true,
    });
    assert.equal(r.reason, "recent_seen_dedupe_window");
  });

  test("canonical_row_missing when row null", () => {
    const r = evaluateOpenClawShadowParseEligibility(null, {
      now,
      recentSeenBlocks: false,
    });
    assert.equal(r.reason, "canonical_row_missing");
  });

  test("sourceUrlHost extracts hostname", () => {
    assert.equal(sourceUrlHost("https://jobs.lever.co/acme/123"), "jobs.lever.co");
    assert.equal(sourceUrlHost(""), null);
  });

  test("mergeOpenClawShadowEvalIntoSummary aggregates by ATS", () => {
    const s = createEmptyOpenClawShadowSummary();
    mergeOpenClawShadowEvalIntoSummary(
      s,
      { eligible: true, reason: "eligible", processorWouldSkipParse: false },
      "workday",
    );
    mergeOpenClawShadowEvalIntoSummary(
      s,
      { eligible: false, reason: "missing_description", processorWouldSkipParse: true },
      "workday",
    );
    assert.equal(s.jobs_shadow_evaluated, 2);
    assert.equal(s.parse_eligible, 1);
    assert.equal(s.parse_ineligible, 1);
    assert.equal(s.ats_breakdown.workday?.eligible, 1);
    assert.equal(s.ats_breakdown.workday?.ineligible, 1);
  });
});
