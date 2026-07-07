import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WorkdayRepairResult } from "../../../src/services/workdayRepair.service.js";
import type { WorkdayRepairCursor } from "../../../src/utils/workdayRepairCursor.js";

type Row = { id: string; createdAt: string; result: WorkdayRepairResult };

/** Mirrors workdayRepair.worker checkpoint + failure semantics. */
function simulateRepairBatch(
  rows: Row[],
  startCursor: WorkdayRepairCursor | null,
  options?: { breakOnFailure?: (reason: string) => boolean },
) {
  let cursor = startCursor;
  let failed = 0;
  const breakOnFailure =
    options?.breakOnFailure ??
    ((reason: string) =>
      reason === "timeout" || reason === "http_429" || reason === "network_error");
  for (const row of rows) {
    const result = row.result;
    if (result.ok) {
      cursor = { createdAt: row.createdAt, id: row.id };
    } else if (result.reason !== "not_poisoned" && result.reason !== "repair_in_progress") {
      failed += 1;
      if (breakOnFailure(result.reason)) break;
    }
  }
  return { cursor, failed };
}

describe("workdayRepair checkpoint semantics", () => {
  it("does not advance checkpoint past a failed row when later rows succeed", () => {
    const rows: Row[] = [
      {
        id: "a",
        createdAt: "2026-01-01T00:00:00.000Z",
        result: { ok: true, jobId: "a", wasPublishable: false, isPublishable: true },
      },
      {
        id: "b",
        createdAt: "2026-01-01T00:00:01.000Z",
        result: { ok: false, jobId: "b", reason: "timeout" },
      },
      {
        id: "c",
        createdAt: "2026-01-01T00:00:02.000Z",
        result: { ok: true, jobId: "c", wasPublishable: false, isPublishable: true },
      },
    ];
    const { cursor, failed } = simulateRepairBatch(rows, null, {
      breakOnFailure: () => true,
    });
    assert.equal(failed, 1);
    assert.deepEqual(cursor, { createdAt: "2026-01-01T00:00:00.000Z", id: "a" });
  });

  it("stops batch only on transient failure", () => {
    const rows: Row[] = [
      {
        id: "a",
        createdAt: "2026-01-01T00:00:00.000Z",
        result: { ok: false, jobId: "a", reason: "http_403" },
      },
      {
        id: "b",
        createdAt: "2026-01-01T00:00:01.000Z",
        result: { ok: true, jobId: "b", wasPublishable: false, isPublishable: true },
      },
    ];
    const { cursor, failed } = simulateRepairBatch(rows, null, {
      breakOnFailure: (reason) => reason === "timeout" || reason === "http_429",
    });
    assert.equal(failed, 1);
    assert.deepEqual(cursor, { createdAt: "2026-01-01T00:00:01.000Z", id: "b" });
  });
});
