import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeSitemapJobCursor,
  encodeSitemapJobCursor,
  type SitemapJobCursor,
} from "../../../../src/modules/job/sitemapCursor.js";

test("sitemap cursor round-trip preserves ordering keys", () => {
  const row: SitemapJobCursor = {
    postedAt: new Date("2024-06-01T12:00:00.000Z"),
    listingFreshnessAt: new Date("2024-06-01T12:00:00.000Z"),
    createdAt: new Date("2024-05-20T08:00:00.000Z"),
    id: "00000000-0000-4000-8000-000000000099",
  };
  const encoded = encodeSitemapJobCursor(row);
  const decoded = decodeSitemapJobCursor(encoded);
  assert.equal(decoded?.id, row.id);
  assert.equal(decoded?.postedAt?.toISOString(), row.postedAt?.toISOString());
  assert.equal(decoded?.listingFreshnessAt.toISOString(), row.listingFreshnessAt.toISOString());
  assert.equal(decoded?.createdAt.toISOString(), row.createdAt.toISOString());
});

test("sitemap cursor supports null postedAt (DISCOVERED bucket)", () => {
  const row: SitemapJobCursor = {
    postedAt: null,
    listingFreshnessAt: new Date("2024-04-01T00:00:00.000Z"),
    createdAt: new Date("2024-04-01T00:00:00.000Z"),
    id: "abc",
  };
  const decoded = decodeSitemapJobCursor(encodeSitemapJobCursor(row));
  assert.equal(decoded?.postedAt, null);
});

test("sitemap cursor rejects invalid encoding", () => {
  assert.throws(() => decodeSitemapJobCursor("not-valid-base64!!!"), /invalid_cursor_encoding/);
});
