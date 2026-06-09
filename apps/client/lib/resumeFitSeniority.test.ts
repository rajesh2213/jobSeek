import test from "node:test";
import assert from "node:assert/strict";
import type { JobItem } from "./api";
import {
  SENIORITY_LEVELS,
  applySeniorityGapCap,
  blendResumeFitScore,
  computeSeniorityFit,
  computeSeniorityFitScore,
  deriveCandidateSeniority,
  deriveJobSeniority,
  deriveSeniorityGapCap,
} from "./resumeFitSeniority";

function job(overrides: Partial<JobItem> = {}): JobItem {
  return {
    id: "job-sen-1",
    title: "Software Engineer",
    company: { id: "c", name: "Co", slug: "co" },
    location: "Remote",
    role: "engineering",
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
    ...overrides,
  } as JobItem;
}

test("SENIORITY_LEVELS exports shared scale", () => {
  assert.equal(SENIORITY_LEVELS.senior, 3);
  assert.equal(SENIORITY_LEVELS.principal, 6);
  assert.equal(SENIORITY_LEVELS.director, 7);
});

test("deriveCandidateSeniority: currentTitle priority", () => {
  const result = deriveCandidateSeniority({
    currentTitle: "Principal Engineer",
    yearsOfExperience: 4,
  });
  assert.equal(result.level, 6);
  assert.equal(result.source, "current_title");
});

test("deriveJobSeniority: title over experienceLevel", () => {
  const result = deriveJobSeniority(
    job({ title: "Staff Engineer", experienceLevel: "junior" }),
  );
  assert.equal(result.level, 5);
  assert.equal(result.source, "title");
});

test("computeSeniorityFitScore: underqualified gaps", () => {
  assert.equal(computeSeniorityFitScore(3, 3), 100);
  assert.equal(computeSeniorityFitScore(3, 6), 40);
  assert.equal(computeSeniorityFitScore(3, 7), 25);
});

test("computeSeniorityFitScore: overqualified softened", () => {
  assert.equal(computeSeniorityFitScore(6, 3), 80);
  assert.equal(computeSeniorityFitScore(7, 3), 70);
  assert.equal(computeSeniorityFitScore(8, 3), 60);
});

test("blendResumeFitScore normalizes missing components", () => {
  assert.equal(blendResumeFitScore(80, 40, 60, 25), 61);
  assert.equal(blendResumeFitScore(80, 40, 60), 67);
  assert.equal(blendResumeFitScore(80, 40, null), 69);
  assert.equal(blendResumeFitScore(80, null, 60), 75);
  assert.equal(blendResumeFitScore(80, null, null), 80);
});

test("deriveSeniorityGapCap: only below role", () => {
  assert.equal(deriveSeniorityGapCap(1, 5), 40);
  assert.equal(deriveSeniorityGapCap(3, 6), 55);
  assert.equal(deriveSeniorityGapCap(4, 6), 70);
  assert.equal(deriveSeniorityGapCap(6, 3), null);
});

test("phase 4 manual matrix", () => {
  const cases = [
    {
      label: "Senior → Senior",
      candidate: { currentTitle: "Senior Software Engineer" },
      job: job({ title: "Senior Software Engineer" }),
      expectLevelCand: 3,
      expectLevelJob: 3,
      expectSeniorityScore: 100,
      expectCap: null,
    },
    {
      label: "Senior → Principal",
      candidate: { currentTitle: "Senior Software Engineer" },
      job: job({ title: "Principal Engineer" }),
      expectLevelCand: 3,
      expectLevelJob: 6,
      expectSeniorityScore: 40,
      expectCap: 55,
    },
    {
      label: "Senior → Director",
      candidate: { currentTitle: "Senior Software Engineer" },
      job: job({ title: "Director Product" }),
      expectLevelCand: 3,
      expectLevelJob: 7,
      expectSeniorityScore: 25,
      expectCap: 40,
    },
    {
      label: "Principal → Senior",
      candidate: { currentTitle: "Principal Engineer" },
      job: job({ title: "Senior Engineer" }),
      expectLevelCand: 6,
      expectLevelJob: 3,
      expectSeniorityScore: 80,
      expectCap: null,
    },
    {
      label: "Director → Senior",
      candidate: { currentTitle: "Director Engineering" },
      job: job({ title: "Senior Engineer" }),
      expectLevelCand: 7,
      expectLevelJob: 3,
      expectSeniorityScore: 70,
      expectCap: null,
    },
    {
      label: "Junior → Staff",
      candidate: { currentTitle: "Junior Developer" },
      job: job({ title: "Staff Engineer" }),
      expectLevelCand: 1,
      expectLevelJob: 5,
      expectSeniorityScore: 25,
      expectCap: 40,
    },
    {
      label: "Junior → VP",
      candidate: { currentTitle: "Junior Developer" },
      job: job({ title: "VP Engineering" }),
      expectLevelCand: 1,
      expectLevelJob: 8,
      expectSeniorityScore: 25,
      expectCap: 40,
    },
    {
      label: "Unknown title",
      candidate: {},
      job: job({ title: "Team Member" }),
      expectLevelCand: null,
      expectLevelJob: null,
      expectSeniorityScore: null,
      expectCap: null,
    },
  ] as const;

  for (const c of cases) {
    const fit = computeSeniorityFit(c.job, c.candidate);
    assert.equal(fit.candidateLevel, c.expectLevelCand, `${c.label} candidate level`);
    assert.equal(fit.jobLevel, c.expectLevelJob, `${c.label} job level`);
    assert.equal(fit.seniorityFitScore, c.expectSeniorityScore, `${c.label} seniority score`);

    const skills = 90;
    const raw = blendResumeFitScore(skills, 100, fit.seniorityFitScore);
    const senCap = applySeniorityGapCap(raw, fit.candidateLevel, fit.jobLevel);
    assert.equal(senCap.cap, c.expectCap, `${c.label} cap`);
    if (c.expectCap != null) {
      assert.ok((senCap.score ?? 0) <= c.expectCap, `${c.label} final capped`);
    }
  }
});

test("principal vs senior no longer equivalent at same years", () => {
  const senior = computeSeniorityFit(
    job({ title: "Senior Engineer" }),
    { currentTitle: "Senior Software Engineer", yearsOfExperience: 6 },
  );
  const principal = computeSeniorityFit(
    job({ title: "Principal Engineer" }),
    { currentTitle: "Senior Software Engineer", yearsOfExperience: 6 },
  );
  assert.equal(senior.seniorityFitScore, 100);
  assert.equal(principal.seniorityFitScore, 40);
  assert.notEqual(senior.seniorityFitScore, principal.seniorityFitScore);
});
