import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  deriveFreshness,
  formatRelativeFreshness,
  FRESHNESS_LABELS,
} from "../../../src/utils/freshness.js";

const NOW = new Date("2026-05-12T12:00:00.000Z");

describe("deriveFreshness", () => {
  it("marks POSTED when postedAt is set", () => {
    const f = deriveFreshness(
      { postedAt: new Date("2026-05-12T10:00:00.000Z"), createdAt: new Date("2026-05-12T11:00:00.000Z") },
      NOW,
    );
    assert.equal(f.source, "POSTED");
    assert.equal(f.label, "Posted");
    assert.equal(f.timestamp, "2026-05-12T10:00:00.000Z");
    assert.equal(f.relative, "Posted 2 hours ago");
  });

  it("marks DISCOVERED when postedAt is null", () => {
    const f = deriveFreshness(
      { postedAt: null, createdAt: new Date("2026-05-12T10:00:00.000Z") },
      NOW,
    );
    assert.equal(f.source, "DISCOVERED");
    assert.equal(f.label, "Added");
    assert.equal(f.timestamp, "2026-05-12T10:00:00.000Z");
    assert.equal(f.relative, "Added 2 hours ago");
  });

  it("accepts ISO strings", () => {
    const f = deriveFreshness(
      { postedAt: "2026-05-12T11:30:00.000Z", createdAt: "2026-05-12T11:30:00.000Z" },
      NOW,
    );
    assert.equal(f.source, "POSTED");
    assert.equal(f.relative, "Posted 30 minutes ago");
  });

  it("treats the string \"null\" as null (defensive against JSON cache stringification)", () => {
    const f = deriveFreshness(
      { postedAt: "null", createdAt: new Date("2026-05-12T10:00:00.000Z") },
      NOW,
    );
    assert.equal(f.source, "DISCOVERED");
    assert.equal(f.label, "Added");
  });

  it("treats invalid postedAt as DISCOVERED instead of throwing", () => {
    const f = deriveFreshness(
      { postedAt: "not-a-date", createdAt: new Date("2026-05-12T10:00:00.000Z") },
      NOW,
    );
    assert.equal(f.source, "DISCOVERED");
  });

  it("emits a short date when older than ~6 months", () => {
    const old = new Date("2024-01-15T00:00:00.000Z");
    const f = deriveFreshness({ postedAt: old, createdAt: old }, NOW);
    assert.match(f.relative, /^Posted on Jan 15, 2024$/);
  });
});

describe("formatRelativeFreshness", () => {
  it("just now for sub-minute diffs", () => {
    const t = new Date(NOW.getTime() - 10_000);
    assert.equal(formatRelativeFreshness("Posted", t, NOW), "Posted just now");
  });

  it("singular vs plural minutes", () => {
    const t1 = new Date(NOW.getTime() - 60_000);
    const t5 = new Date(NOW.getTime() - 5 * 60_000);
    assert.equal(formatRelativeFreshness("Added", t1, NOW), "Added 1 minute ago");
    assert.equal(formatRelativeFreshness("Added", t5, NOW), "Added 5 minutes ago");
  });

  it("yesterday for 1 day", () => {
    const t = new Date(NOW.getTime() - 86_400_000);
    assert.equal(formatRelativeFreshness("Posted", t, NOW), "Posted yesterday");
  });

  it("weeks for 7-29 days", () => {
    const t = new Date(NOW.getTime() - 14 * 86_400_000);
    assert.equal(formatRelativeFreshness("Posted", t, NOW), "Posted 2 weeks ago");
  });
});

describe("FRESHNESS_LABELS", () => {
  it("exports POSTED → Posted and DISCOVERED → Added", () => {
    assert.equal(FRESHNESS_LABELS.POSTED, "Posted");
    assert.equal(FRESHNESS_LABELS.DISCOVERED, "Added");
  });
});
