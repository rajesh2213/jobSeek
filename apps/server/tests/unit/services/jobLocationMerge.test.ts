import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Job } from "@prisma/client";
import {
  computeLocationPatchFromReingest,
  computeSkillsPatchFromReingest,
  computeWorkModePatchFromReingest,
  isMissingLocation,
  mergeSkillsUnionForCanonical,
  mergeStructuredLocationFromSources,
} from "../../../src/services/jobCanonical.service.js";
import { deduplicateAndInsert } from "../../../src/services/jobDedup.service.js";
import type { JobRepository } from "../../../src/modules/job/job.repository.js";

function jobBase(overrides: Partial<Job> = {}): Job {
  const now = new Date();
  return {
    id: "job-1",
    title: "Engineer",
    companyId: "co-1",
    country: "UNKNOWN",
    locationCity: null,
    locationState: null,
    locationCountry: "UNKNOWN",
    locationRegion: null,
    isRemote: false,
    workType: "onsite",
    experienceLevel: null,
    category: "other",
    description: "Long enough description for dedup similarity checks.",
    parsedDescription: null,
    enriched: null,
    source: "workday",
    sourceUrl: "https://example.com/careers/1",
    applyUrl: null,
    postedAt: now,
    lastSeenAt: now,
    fingerprint: "fp",
    canonicalJobId: null,
    fingerprintVersion: "v2",
    atsJobId: null,
    freshnessScore: 0.5,
    sourceWeight: 0.85,
    role: "engineer",
    skills: [],
    salaryMin: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Job;
}

describe("mergeStructuredLocationFromSources", () => {
  it("picks non-UNKNOWN locationCountry from a lower-weight source when higher-weight rows are UNKNOWN", () => {
    const high = jobBase({
      id: "a",
      source: "greenhouse",
      country: "UNKNOWN",
      locationCountry: "UNKNOWN",
    });
    const low = jobBase({
      id: "b",
      source: "careers_page",
      country: "UNKNOWN",
      locationCountry: "DE",
      locationCity: "Berlin",
    });
    const out = mergeStructuredLocationFromSources([high, low]);
    assert.equal(out.locationCountry, "DE");
    assert.equal(out.locationCity, "Berlin");
    assert.equal(out.country, "DE");
  });

  it("fills city, state, and region from highest-quality rows that have values", () => {
    const j1 = jobBase({
      id: "1",
      source: "greenhouse",
      locationCountry: "US",
      locationCity: "Austin",
      locationState: null,
      locationRegion: null,
    });
    const j2 = jobBase({
      id: "2",
      source: "lever",
      locationCountry: "US",
      locationCity: null,
      locationState: "TX",
      locationRegion: null,
    });
    const j3 = jobBase({
      id: "3",
      source: "careers_page",
      locationCountry: "US",
      locationCity: null,
      locationState: null,
      locationRegion: "Americas",
    });
    const out = mergeStructuredLocationFromSources([j1, j2, j3]);
    assert.equal(out.locationCity, "Austin");
    assert.equal(out.locationState, "TX");
    assert.equal(out.locationRegion, "Americas");
  });
});

describe("isMissingLocation", () => {
  it("treats null, empty, whitespace, and UNKNOWN as missing", () => {
    assert.equal(isMissingLocation(null), true);
    assert.equal(isMissingLocation(undefined), true);
    assert.equal(isMissingLocation(""), true);
    assert.equal(isMissingLocation("   "), true);
    assert.equal(isMissingLocation("UNKNOWN"), true);
    assert.equal(isMissingLocation("US"), false);
  });
});

describe("computeLocationPatchFromReingest", () => {
  it("upgrades when existing locationCountry is null or empty string", () => {
    for (const blank of [null, ""]) {
      const row = jobBase({
        country: "UNKNOWN",
        locationCountry: blank as unknown as string,
        locationCity: null,
      });
      const patch = computeLocationPatchFromReingest(row, {
        country: "IN",
        locationCountry: "IN",
        locationCity: "Bengaluru",
        locationState: null,
        locationRegion: null,
      });
      assert.ok(patch, String(blank));
      assert.equal(patch!.locationCountry, "IN");
      assert.equal(patch!.locationCity, "Bengaluru");
    }
  });

  it("does not overwrite valid locationCountry with different incoming", () => {
    const row = jobBase({
      country: "US",
      locationCountry: "US",
      locationCity: "Chicago",
    });
    const patch = computeLocationPatchFromReingest(row, {
      country: "DE",
      locationCountry: "DE",
      locationCity: "Berlin",
      locationState: null,
      locationRegion: null,
    });
    assert.equal(patch, null);
  });

  it("returns null when incoming does not improve stored location", () => {
    const row = jobBase({
      country: "US",
      locationCountry: "US",
      locationCity: "NYC",
    });
    const patch = computeLocationPatchFromReingest(row, {
      country: "US",
      locationCountry: "US",
      locationCity: "NYC",
      locationState: null,
      locationRegion: null,
    });
    assert.equal(patch, null);
  });

  it("upgrades UNKNOWN locationCountry from incoming", () => {
    const row = jobBase({
      country: "UNKNOWN",
      locationCountry: "UNKNOWN",
      locationCity: null,
    });
    const patch = computeLocationPatchFromReingest(row, {
      country: "UNKNOWN",
      locationCountry: "IE",
      locationCity: null,
      locationState: null,
      locationRegion: null,
    });
    assert.ok(patch);
    assert.equal(patch!.locationCountry, "IE");
    assert.equal(patch!.country, "IE");
  });

  it("fills empty city/state/region without overwriting non-empty", () => {
    const row = jobBase({
      locationCity: null,
      locationState: "CA",
      locationRegion: null,
    });
    const patch = computeLocationPatchFromReingest(row, {
      country: "US",
      locationCountry: "US",
      locationCity: "SF",
      locationState: "NY",
      locationRegion: "West",
    });
    assert.ok(patch);
    assert.equal(patch!.locationCity, "SF");
    assert.equal(patch!.locationState, "CA");
    assert.equal(patch!.locationRegion, "West");
  });
});

describe("computeWorkModePatchFromReingest", () => {
  it("promotes onsite → remote when incoming is remote", () => {
    const row = jobBase({ isRemote: false, workType: "onsite" });
    const patch = computeWorkModePatchFromReingest(row, {
      isRemote: true,
      workType: undefined,
    });
    assert.ok(patch);
    assert.equal(patch!.isRemote, true);
    assert.equal(patch!.workType, "remote");
  });

  it("promotes to hybrid when incoming workType is hybrid", () => {
    const row = jobBase({ isRemote: false, workType: "onsite" });
    const patch = computeWorkModePatchFromReingest(row, {
      isRemote: true,
      workType: "hybrid",
    });
    assert.ok(patch);
    assert.equal(patch!.workType, "hybrid");
  });

  it("returns null when already remote", () => {
    const row = jobBase({ isRemote: true, workType: "remote" });
    const patch = computeWorkModePatchFromReingest(row, {
      isRemote: true,
      workType: "remote",
    });
    assert.equal(patch, null);
  });
});

describe("computeSkillsPatchFromReingest", () => {
  it("returns patch when stale software skills are stored on healthcare row", () => {
    const patch = computeSkillsPatchFromReingest(
      {
        title: "Field Medical Director, Radiology",
        description: "Ongoing support. Go to careers.",
        isRemote: false,
        locationCity: null,
        category: "healthcare",
        skills: ["golang", "typescript", "aws", "recruiting"],
      },
      {
        title: "Field Medical Director, Radiology",
        description: "Ongoing support. Go to careers.",
        isRemote: false,
        category: "healthcare",
        locationCity: null,
      },
    );
    assert.notEqual(patch, null);
    assert.ok(!patch!.includes("golang"));
    assert.ok(!patch!.includes("typescript"));
  });

  it("returns null when stored skills already match recompute", () => {
    const patch = computeSkillsPatchFromReingest(
      {
        title: "Financial Analyst",
        description: "Excel and SQL required.",
        isRemote: false,
        locationCity: "NYC",
        category: "finance",
        skills: ["excel", "sql"],
      },
      {
        title: "Financial Analyst",
        description: "Excel and SQL required.",
        isRemote: false,
        category: "finance",
        locationCity: "NYC",
      },
    );
    assert.equal(patch, null);
  });
});

describe("mergeSkillsUnionForCanonical", () => {
  it("filters contaminated union for healthcare canonical title", () => {
    const skills = mergeSkillsUnionForCanonical(
      [
        { skills: ["golang", "typescript"] },
        { skills: ["aws", "recruiting"] },
      ],
      "Analyst, Performance Suite Analytics",
      "healthcare",
    );
    assert.ok(!skills.includes("golang"));
    assert.ok(!skills.includes("typescript"));
    assert.ok(skills.includes("recruiting"));
  });
});

describe("deduplicateAndInsert idempotent path", () => {
  it("merges structured location and recomputes canonical when location backfills", async () => {
    const existing = jobBase({
      id: "existing-1",
      sourceUrl: "https://workday.example.com/job/1",
      country: "UNKNOWN",
      locationCountry: "UNKNOWN",
      locationCity: null,
      canonicalJobId: null,
    });

    let aggregationUpdates = 0;
    const repo = {
      findBySourceUrl: async () => existing,
      updateLastSeenById: async () => {},
      mergePostedAtIfEarlier: async () => false,
      mergeStructuredLocationFromReingest: async () => true,
      mergeWorkModeFromReingest: async () => false,
      mergeSkillsFromReingest: async () => false,
      resolveCanonicalJob: async (j: Job) => j,
      findByIdRaw: async (id: string) =>
        id === existing.id ? { ...existing, country: "IE", locationCountry: "IE" } : null,
      findDuplicatesByCanonicalId: async () => [],
      updateCanonicalAggregation: async () => {
        aggregationUpdates += 1;
      },
    } as unknown as JobRepository;

    const raw = {
      title: existing.title,
      description: existing.description ?? "",
      isRemote: false,
      source: "workday" as const,
      sourceUrl: existing.sourceUrl,
      companyId: "co-1",
      companyDomain: "example.com",
      location: "Dublin, Ireland",
    };

    await deduplicateAndInsert(repo, raw);
    assert.equal(aggregationUpdates, 1);
  });
});
