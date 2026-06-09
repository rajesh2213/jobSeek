import test from "node:test";
import assert from "node:assert/strict";
import type { JobItem } from "./api";
import {
  applyExperienceGapCap,
  blendSkillsAndExperienceScore,
  computeExperienceFit,
  computeExperienceFitScore,
  deriveCandidateExperienceYears,
  deriveExperienceGapCap,
  deriveJobRequiredYears,
} from "./resumeFitExperience";

function job(overrides: Partial<JobItem> = {}): JobItem {
  return {
    id: "job-exp-1",
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

test("computeExperienceFitScore examples", () => {
  assert.equal(computeExperienceFitScore(6, 5), 100);
  assert.equal(computeExperienceFitScore(5, 5), 100);
  assert.equal(computeExperienceFitScore(4, 5), 88);
  assert.equal(computeExperienceFitScore(3, 5), 76);
  assert.equal(computeExperienceFitScore(2, 5), 64);
  assert.equal(computeExperienceFitScore(1, 5), 52);
  assert.equal(computeExperienceFitScore(0, 5), 40);
});

test("deriveJobRequiredYears: explicit range and plus", () => {
  assert.equal(
    deriveJobRequiredYears(
      job({
        parsedDescription: {
          position: [],
          responsibility: [],
          requirement: ["3-5 years of backend experience"],
          experience: [],
          benefit: [],
          contact: [],
          other: [],
        },
      }),
    ).years,
    4,
  );
  assert.equal(
    deriveJobRequiredYears(
      job({
        parsedDescription: {
          position: [],
          responsibility: [],
          requirement: ["7+ years in platform engineering"],
          experience: [],
          benefit: [],
          contact: [],
          other: [],
        },
      }),
    ).years,
    7,
  );
});

test("deriveJobRequiredYears: title heuristics without explicit override", () => {
  assert.equal(deriveJobRequiredYears(job({ title: "Staff Software Engineer" })).years, 8);
  assert.equal(deriveJobRequiredYears(job({ title: "Junior Developer" })).years, 1);
  assert.equal(
    deriveJobRequiredYears(
      job({
        title: "Senior Software Engineer",
        parsedDescription: {
          position: [],
          responsibility: [],
          requirement: ["5+ years required"],
          experience: [],
          benefit: [],
          contact: [],
          other: [],
        },
      }),
    ).years,
    5,
  );
});

test("deriveCandidateExperienceYears priority", () => {
  const structured = {
    experience: [
      { startDate: "2018-01", endDate: "2020-06", bullets: [] },
      { startDate: "2020-07", endDate: "present", bullets: [] },
    ],
  };
  assert.equal(
    deriveCandidateExperienceYears({
      yearsOfExperience: 6,
      resumeStructuredV1: structured,
      applyProfileSummary: { yearsExp: 2 },
    }).years,
    6,
  );
  assert.equal(
    deriveCandidateExperienceYears({
      yearsOfExperience: null,
      resumeStructuredV1: structured,
      applyProfileSummary: { yearsExp: 2 },
    }).source,
    "structured_resume",
  );
});

test("manual matrix: senior mismatch penalized", () => {
  const staff = computeExperienceFit(
    job({ title: "Staff Engineer", parsedDescription: { position: [], responsibility: [], requirement: [], experience: ["8+ years"], benefit: [], contact: [], other: [] } }),
    { yearsOfExperience: 2 },
  );
  assert.equal(staff.experienceFitScore, 40);

  const juniorMatch = computeExperienceFit(job({ title: "Junior Engineer" }), { yearsOfExperience: 1 });
  assert.equal(juniorMatch.experienceFitScore, 100);

  const seniorMatch = computeExperienceFit(job({ title: "Senior Engineer" }), { yearsOfExperience: 6 });
  assert.equal(seniorMatch.experienceFitScore, 100);

  const seniorOnJunior = computeExperienceFit(job({ title: "Junior Engineer" }), { yearsOfExperience: 8 });
  assert.equal(seniorOnJunior.experienceFitScore, 100);

  const unknown = computeExperienceFit(job({ title: "Analyst" }), {});
  assert.equal(unknown.experienceFitScore, null);

  const noReq = computeExperienceFit(job({ title: "Team Member" }), { yearsOfExperience: 4 });
  assert.equal(noReq.experienceFitScore, null);
});

test("blendSkillsAndExperienceScore", () => {
  assert.equal(blendSkillsAndExperienceScore(80, 40), 72);
  assert.equal(blendSkillsAndExperienceScore(80, null), 80);
});

test("deriveExperienceGapCap thresholds", () => {
  assert.equal(deriveExperienceGapCap(4, 5), null);
  assert.equal(deriveExperienceGapCap(2, 5), 65);
  assert.equal(deriveExperienceGapCap(0, 5), 50);
  assert.equal(deriveExperienceGapCap(0, 8), 35);
  assert.equal(deriveExperienceGapCap(8, 5), null);
  assert.equal(deriveExperienceGapCap(null, 5), null);
});

test("applyExperienceGapCap: high skills cannot mask large experience gap", () => {
  const blended = blendSkillsAndExperienceScore(95, 40);
  assert.equal(blended, 84);
  const capped = applyExperienceGapCap(blended, 2, 8);
  assert.equal(capped.cap, 50);
  assert.equal(capped.score, 50);
  assert.equal(capped.capApplied, true);
});

test("phase 3.1 manual matrix", () => {
  const cases = [
    {
      label: "1 year vs 8 year role",
      candidate: 1,
      required: 8,
      skills: 95,
      expectCap: 50,
      expectFinal: 50,
    },
    {
      label: "2 year vs 5 year role",
      candidate: 2,
      required: 5,
      skills: 90,
      expectCap: 65,
      expectFinal: 65,
    },
    {
      label: "4 year vs 5 year role",
      candidate: 4,
      required: 5,
      skills: 90,
      expectCap: null,
      expectFinal: 90,
    },
    {
      label: "8 year vs 5 year role",
      candidate: 8,
      required: 5,
      skills: 90,
      expectCap: null,
      expectFinal: 92,
    },
    {
      label: "unknown experience",
      candidate: null,
      required: 8,
      skills: 90,
      expectCap: null,
      expectFinal: 90,
    },
  ] as const;

  for (const c of cases) {
    const experienceScore = computeExperienceFitScore(c.candidate, c.required);
    const raw = blendSkillsAndExperienceScore(c.skills, experienceScore);
    const { cap, score, capApplied } = applyExperienceGapCap(raw, c.candidate, c.required);
    assert.equal(cap, c.expectCap, `${c.label} cap`);
    assert.equal(score, c.expectFinal, `${c.label} final`);
    if (c.expectCap != null) assert.equal(capApplied, true, `${c.label} applied`);
    else assert.equal(capApplied, false, `${c.label} not applied`);
  }
});
