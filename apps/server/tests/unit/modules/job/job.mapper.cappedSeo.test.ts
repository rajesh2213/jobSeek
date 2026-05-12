import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  toJobDetailJson,
  toJobPublicJsonOverDailyCap,
  type JobWithCompanyRow,
} from "../../../../src/modules/job/job.mapper.js";

function sampleJob(overrides: Partial<JobWithCompanyRow> = {}): JobWithCompanyRow {
  const base = {
    id: "job_1",
    companyId: "co_1",
    title: "Senior Writing - Marketing",
    description: "Line one.\nLine two.",
    sourceUrl: "https://example.com/jobs/1",
    applyUrl: "https://example.com/apply/1",
    role: "writer",
    category: "marketing",
    country: "MX",
    locationCity: "Mexico City",
    locationState: null,
    locationCountry: "MX",
    locationRegion: "LATAM",
    isRemote: true,
    workType: "remote",
    experienceLevel: null,
    salaryMin: null,
    postedAt: "2026-05-12T06:57:21.746Z",
    effectivePostedAt: "2026-05-12T06:57:21.746Z",
    parsedDescription: null,
    enriched: null,
    status: "ready",
    qualityCheckedAt: null,
    qualityScore: null,
    qualityFlags: null,
    hasNonemptyDescription: true,
    createdAt: new Date("2026-05-12T06:57:21.746Z"),
    updatedAt: new Date("2026-05-12T06:57:21.746Z"),
    company: {
      id: "co_1",
      name: "Tribute Kiosk",
      slug: "tribute-kiosk",
      logoUrl: null,
      domain: "truelogic.io",
      careersUrl: "https://example.com/careers",
      _count: { jobs: 10 },
    },
  } as unknown as JobWithCompanyRow;
  return { ...base, ...overrides };
}

describe("job mapper capped structured-data fallback", () => {
  const cleanedDescription = "Line one. Line two.";

  it("keeps uncapped detail description unchanged", () => {
    const detail = toJobDetailJson(sampleJob()) as Record<string, unknown>;
    assert.equal(detail.description, cleanedDescription);
    assert.equal(detail.structuredDataDescription, undefined);
  });

  it("keeps capped payload redacted but preserves structuredDataDescription", () => {
    const capped = toJobPublicJsonOverDailyCap(sampleJob()) as Record<string, unknown>;
    assert.equal(capped.description, null);
    assert.equal(capped.parsedDescription, null);
    assert.equal(capped.applyUrl, null);
    assert.equal(capped.sourceUrl, null);
    assert.equal(capped.structuredDataDescription, cleanedDescription);
  });
});
