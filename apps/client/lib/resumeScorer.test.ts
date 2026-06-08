import test from "node:test";
import assert from "node:assert/strict";
import type { JobItem } from "./api";
import {
  jobHasMatchSignals,
  isResumeMatchScored,
  scoreResume,
} from "./resumeScorer";

const emptyParsedDescription = {
  position: [],
  responsibility: [],
  requirement: [],
  experience: [],
  benefit: [],
  contact: [],
  other: [],
};

function minimalJob(overrides: Partial<JobItem> = {}): JobItem {
  return {
    id: "job-test-1",
    title: "Senior Product Manager",
    company: { id: "co-1", name: "Pearl", slug: "pearl" },
    location: "India",
    workMode: "onsite",
    employmentType: "full_time",
    postedAt: "2026-05-01T00:00:00.000Z",
    skills: [],
    description:
      "Experience with SQL analytics, agile delivery, cross-functional collaboration, and stakeholder management.",
    parsedDescription: emptyParsedDescription,
    ...overrides,
  } as JobItem;
}

test("jobHasMatchSignals: true for PM title via role hints when dictionary empty", () => {
  const job = minimalJob();
  assert.equal(jobHasMatchSignals(job), true);
});

test("jobHasMatchSignals: false when no dictionary, JD, or text corpus", () => {
  const job = minimalJob({
    title: "Team Member",
    description: "",
    previewLines: [],
    parsedDescription: emptyParsedDescription,
  });
  assert.equal(jobHasMatchSignals(job), false);
});

test("jobHasMatchSignals: true when taxonomy skills present", () => {
  const job = minimalJob({ skills: ["react", "typescript"] });
  assert.equal(jobHasMatchSignals(job), true);
});

test("scoreResume: scored for PM via role hints", () => {
  const result = scoreResume(
    "Led agile roadmaps with SQL analytics in Jira",
    ["Drove product discovery using SQL and Figma"],
    minimalJob(),
  );
  assert.equal(result.matchAvailability, "scored");
  assert.ok(result.score !== null);
});

test("scoreResume: insufficient_job_signals when no resolvable signals", () => {
  const result = scoreResume(
    "Built React apps",
    ["Led product roadmap"],
    minimalJob({
      title: "Team Member",
      description: "",
      previewLines: [],
      parsedDescription: emptyParsedDescription,
    }),
  );
  assert.equal(result.matchAvailability, "insufficient_job_signals");
  assert.equal(result.score, null);
  assert.equal(result.grade, null);
  assert.equal(result.matched.length, 0);
  assert.equal(result.missing.length, 0);
  assert.equal(isResumeMatchScored(result), false);
});

test("scoreResume: scored when job has skills", () => {
  const job = minimalJob({
    skills: ["react"],
    parsedDescription: {
      ...emptyParsedDescription,
      requirement: ["5+ years experience with React and TypeScript"],
    },
  });
  const result = scoreResume("React developer with TypeScript", ["Built React UI"], job);
  assert.equal(result.matchAvailability, "scored");
  assert.ok(result.score !== null);
  assert.ok(result.grade !== null);
  assert.equal(isResumeMatchScored(result), true);
});
