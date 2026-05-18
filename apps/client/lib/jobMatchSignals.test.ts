import test from "node:test";
import assert from "node:assert/strict";
import type { JobItem } from "./api";
import {
  MIN_JOB_MATCH_SIGNALS,
  jobHasResolvableMatchSignals,
  resolveJobMatchSkills,
} from "./jobMatchSignals";

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
    id: "job-signals-1",
    title: "Senior Product Manager",
    company: { id: "co-1", name: "Pearl", slug: "pearl" },
    location: "India",
    role: "product-manager",
    skills: [],
    parsedDescription: emptyParsedDescription,
    ...overrides,
  } as JobItem;
}

test("resolveJobMatchSkills: role hints for PM title when dictionary empty", () => {
  const skills = resolveJobMatchSkills(minimalJob());
  assert.ok(skills.length >= MIN_JOB_MATCH_SIGNALS);
  assert.ok(skills.some((s) => s.source === "role_hint"));
  assert.ok(skills.some((s) => s.canonical === "agile" || s.canonical === "sql"));
});

test("resolveJobMatchSkills: sparse JD fallback from requirements", () => {
  const skills = resolveJobMatchSkills(
    minimalJob({
      title: "Operations Coordinator",
      parsedDescription: {
        ...emptyParsedDescription,
        requirement: [
          "Experience with SQL analytics, Agile delivery, and Jira workflows",
        ],
      },
    }),
  );
  assert.ok(skills.length >= MIN_JOB_MATCH_SIGNALS);
  assert.ok(skills.some((s) => s.canonical === "sql"));
  assert.ok(
    skills.some(
      (s) =>
        s.source === "sparse_requirement" &&
        (s.canonical === "agile" || s.canonical === "jira" || s.canonical === "analytics"),
    ),
  );
});

test("jobHasResolvableMatchSignals: false only when title and JD lack all signals", () => {
  assert.equal(
    jobHasResolvableMatchSignals(
      minimalJob({
        title: "Team Member",
        parsedDescription: emptyParsedDescription,
      }),
    ),
    false,
  );
});
