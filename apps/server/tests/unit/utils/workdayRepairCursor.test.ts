import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodeWorkdayRepairCursor,
  encodeWorkdayRepairCursor,
  workdayCursorWhere,
} from "../../../src/utils/workdayRepairCursor.js";

describe("workdayRepairCursor", () => {
  it("round-trips createdAt + id", () => {
    const cursor = { createdAt: "2026-01-15T10:00:00.000Z", id: "job-uuid-1" };
    const encoded = encodeWorkdayRepairCursor(cursor);
    assert.deepEqual(decodeWorkdayRepairCursor(encoded), cursor);
  });

  it("orders deterministically by createdAt then id", () => {
    const a = new Date("2026-01-01T00:00:00.000Z");
    const b = new Date("2026-01-02T00:00:00.000Z");
    const rows = [
      { createdAt: b, id: "b" },
      { createdAt: a, id: "z" },
      { createdAt: a, id: "a" },
    ].sort((x, y) => {
      if (x.createdAt.getTime() !== y.createdAt.getTime()) {
        return x.createdAt.getTime() - y.createdAt.getTime();
      }
      return x.id.localeCompare(y.id);
    });
    assert.deepEqual(rows.map((r) => r.id), ["a", "z", "b"]);
  });

  it("builds keyset where for resume", () => {
    const where = workdayCursorWhere({
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "abc",
    });
    assert.ok(where.OR);
    assert.equal(where.OR!.length, 2);
  });
});
