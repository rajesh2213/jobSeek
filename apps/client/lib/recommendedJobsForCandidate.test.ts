import test from "node:test";
import assert from "node:assert/strict";
import type { JobItem } from "./api";
import {
  familyBoostForRecommendation,
  getRecommendedJobsForCandidate,
  rankRecommendedJobsForCandidate,
} from "./recommendedJobsForCandidate";

function job(overrides: Partial<JobItem> = {}): JobItem {
  return {
    id: overrides.id ?? "job-1",
    title: "Software Engineer",
    company: { id: "c", name: "Co", slug: "co" },
    location: "Remote",
    role: "software-engineer",
    category: "engineering",
    skills: [],
    description: "Build APIs",
    parsedDescription: {
      position: [],
      responsibility: [],
      requirement: [],
      experience: [],
      benefit: [],
      contact: [],
      other: [],
    },
    postedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  } as JobItem;
}

test("familyBoostForRecommendation: same and adjacent only", () => {
  assert.equal(familyBoostForRecommendation("software.engineering", "software.engineering"), 100);
  assert.equal(familyBoostForRecommendation("software.engineering", "engineering.backend"), 40);
  assert.equal(familyBoostForRecommendation("marketing", "sales"), 0);
});

test("getRecommendedJobsForCandidate: same family before adjacent, freshness tie-break", () => {
  const jobs = [
    job({ id: "older-swe", title: "Software Engineer", postedAt: "2026-05-01T00:00:00.000Z" }),
    job({ id: "newer-swe", title: "Senior Software Engineer", postedAt: "2026-06-08T00:00:00.000Z" }),
    job({ id: "backend", title: "Backend Engineer", postedAt: "2026-06-09T00:00:00.000Z" }),
    job({ id: "sales", title: "Sales Executive", category: "sales", postedAt: "2026-06-09T00:00:00.000Z" }),
  ];

  const ranked = rankRecommendedJobsForCandidate("software.engineering", jobs);
  assert.equal(ranked[0]?.job.id, "newer-swe");
  assert.equal(ranked[0]?.bucket, "same_family");
  assert.equal(ranked[1]?.job.id, "older-swe");
  assert.equal(ranked[2]?.job.id, "backend");
  assert.equal(ranked[2]?.bucket, "adjacent_family");
  assert.equal(ranked.some((r) => r.job.id === "sales"), false);

  const top = getRecommendedJobsForCandidate("software.engineering", jobs, 2);
  assert.deepEqual(
    top.map((j) => j.id),
    ["newer-swe", "older-swe"],
  );
});
