import test from "node:test";
import assert from "node:assert/strict";
import { diffJobListJsonArrays, jsonStableStringify } from "../../../../src/modules/job/jobListShadow.util.js";

test("jsonStableStringify sorts object keys", () => {
  const a = { z: 1, a: 2 };
  const b = { a: 2, z: 1 };
  assert.equal(jsonStableStringify(a), jsonStableStringify(b));
});

test("diffJobListJsonArrays detects length mismatch", () => {
  const d = diffJobListJsonArrays([{ id: "1" }], []);
  assert.equal(d.equal, false);
  assert.match(d.mismatchHint ?? "", /length/);
});

test("diffJobListJsonArrays equal for identical rows", () => {
  const rows = [{ id: "x", description: "hello" }];
  const d = diffJobListJsonArrays(rows, rows);
  assert.equal(d.equal, true);
});

test("diffJobListJsonArrays detects value change", () => {
  const d = diffJobListJsonArrays([{ id: "1", a: 1 }], [{ id: "1", a: 2 }]);
  assert.equal(d.equal, false);
  assert.equal(d.firstMismatchIndex, 0);
});
