import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Job } from "@prisma/client";

import { aggregateCanonicalFromSources } from "../../../src/services/jobCanonical.service.js";

function jobBase(overrides: Partial<Job> = {}): Job {
  const now = new Date("2026-05-10T00:00:00.000Z");
  return {
    id: "job-1",
    title: "Engineer",
    companyId: "co-1",
    country: "US",
    locationCity: null,
    locationState: null,
    locationCountry: "US",
    locationRegion: null,
    isRemote: false,
    workType: "onsite",
    experienceLevel: null,
    category: "engineering",
    description: "Long enough description for dedup similarity checks.",
    parsedDescription: null,
    enriched: null,
    source: "workday",
    sourceUrl: "https://example.com/careers/1",
    applyUrl: null,
    postedAt: now,
    effectivePostedAt: now,
    listingFreshnessAt: now,
    lastSeenAt: now,
    lastProcessedAt: null,
    contentHash: null,
    expiresAt: null,
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
    isActive: true,
    isPublishable: null,
    requiresRepair: null,
    status: "ready",
    ...overrides,
  } as Job;
}

const T = (iso: string) => new Date(iso);

describe("aggregateCanonicalFromSources — postedAt picking policy", () => {
  it("picks the EARLIEST non-null postedAt across canonical + duplicates", () => {
    const canonical = jobBase({
      id: "c",
      source: "lever",
      postedAt: T("2026-05-10T00:00:00.000Z"),
      canonicalJobId: null,
    });
    const dupEarlier = jobBase({
      id: "d1",
      source: "workday",
      postedAt: T("2026-05-08T00:00:00.000Z"), // earlier — should win
      canonicalJobId: "c",
    });
    const dupLater = jobBase({
      id: "d2",
      source: "ashby",
      postedAt: T("2026-05-12T00:00:00.000Z"),
      canonicalJobId: "c",
    });

    const out = aggregateCanonicalFromSources([canonical, dupEarlier, dupLater]);
    assert.deepEqual(out.postedAt, T("2026-05-08T00:00:00.000Z"));
  });

  it("treats NULL postedAt rows as no signal — does not overwrite a real date", () => {
    const canonical = jobBase({
      id: "c",
      source: "lever",
      postedAt: T("2026-05-10T00:00:00.000Z"),
      canonicalJobId: null,
    });
    const dupNull = jobBase({
      id: "d1",
      source: "careers_page",
      postedAt: null,
      canonicalJobId: "c",
    });
    const out = aggregateCanonicalFromSources([canonical, dupNull]);
    assert.deepEqual(out.postedAt, T("2026-05-10T00:00:00.000Z"));
  });

  it("returns NULL when every duplicate has NULL postedAt (DISCOVERED stays DISCOVERED after merge)", () => {
    const canonical = jobBase({ id: "c", source: "careers_page", postedAt: null, canonicalJobId: null });
    const dup1 = jobBase({ id: "d1", source: "wellfound", postedAt: null, canonicalJobId: "c" });
    const dup2 = jobBase({ id: "d2", source: "careers_page", postedAt: null, canonicalJobId: "c" });

    const out = aggregateCanonicalFromSources([canonical, dup1, dup2]);
    assert.equal(out.postedAt, null);
  });

  it("a NULL canonical postedAt is replaced by an earlier real date from a duplicate", () => {
    // Mirrors the common case: canonical was created from a careers_page (no postedAt),
    // then a duplicate from Lever (with real postedAt) was attached. After recompute,
    // the canonical surface should "upgrade" to POSTED.
    const canonical = jobBase({ id: "c", source: "careers_page", postedAt: null, canonicalJobId: null });
    const dup = jobBase({
      id: "d1",
      source: "lever",
      postedAt: T("2026-05-09T00:00:00.000Z"),
      canonicalJobId: "c",
    });
    const out = aggregateCanonicalFromSources([canonical, dup]);
    assert.deepEqual(out.postedAt, T("2026-05-09T00:00:00.000Z"));
  });

  it("freshnessScore is derived from the picked postedAt (or createdAt fallback)", () => {
    const canonical = jobBase({
      id: "c",
      source: "lever",
      postedAt: T("2026-05-10T00:00:00.000Z"),
      createdAt: T("2026-05-12T00:00:00.000Z"),
      canonicalJobId: null,
    });
    const out = aggregateCanonicalFromSources([canonical]);
    assert.ok(typeof out.freshnessScore === "number");
    // freshness decays from postedAt — a 2-day-old role should score higher than a 30-day-old one
    const stale = aggregateCanonicalFromSources([
      jobBase({
        id: "s",
        source: "lever",
        postedAt: T("2026-04-10T00:00:00.000Z"),
        createdAt: T("2026-05-12T00:00:00.000Z"),
        canonicalJobId: null,
      }),
    ]);
    assert.ok(out.freshnessScore > stale.freshnessScore);
  });
});
