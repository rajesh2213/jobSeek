import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseGreenhouseJobList } from "../../../../../src/modules/ats/greenhouse/greenhouse.parser.js";

describe("parseGreenhouseJobList", () => {
  it("sets atsJobId from Greenhouse job id", () => {
    const jobs = parseGreenhouseJobList(
      [
        {
          id: 7743126,
          title: "Account Executive DACH",
          updated_at: "2026-01-01T00:00:00-05:00",
          absolute_url: "https://navan.com/careers/openings?gh_jid=7743126",
          location: { name: "Berlin" },
        },
      ],
      "company-1",
    );
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.atsJobId, "7743126");
    assert.equal(jobs[0]?.sourceUrl, "https://navan.com/careers/openings?gh_jid=7743126");
  });
});
