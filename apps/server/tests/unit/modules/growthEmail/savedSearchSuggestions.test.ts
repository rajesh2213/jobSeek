import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { savedSearchSuggestionsFilters } from "../../../../src/modules/growthEmail/growthEmail.service.js";
import { discoveryFiltersFromSavedSearchQuery } from "../../../../src/modules/saved-search/savedSearch.service.js";

describe("savedSearchSuggestionsFilters", () => {
  const now = new Date("2026-06-10T12:00:00.000Z");

  it("applies saved-search discovery filters plus a 7-day postedAfter window", () => {
    const query = "/jobs?role=software-engineer&remote=true";
    const base = discoveryFiltersFromSavedSearchQuery(query);
    const filters = savedSearchSuggestionsFilters(query, now);

    assert.ok(filters.role ?? filters.roles?.length);
    assert.equal(filters.isRemote, true);
    assert.ok(filters.postedAfter instanceof Date);
    assert.equal(
      filters.postedAfter!.getTime(),
      now.getTime() - 7 * 24 * 60 * 60 * 1000,
    );
    assert.equal(base.postedWithin, undefined);
  });

  it("preserves companyId filter from saved search query", () => {
    const query = "/jobs?companyId=cmp_abc123";
    const filters = savedSearchSuggestionsFilters(query, now);

    assert.equal(filters.companyId, "cmp_abc123");
    assert.ok(filters.postedAfter instanceof Date);
  });
});
