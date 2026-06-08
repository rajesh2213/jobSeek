import test from "node:test";
import assert from "node:assert/strict";
import type { JobItem } from "./api";
import {
  MIN_JOB_MATCH_SIGNALS,
  isDescriptionFallbackKeyword,
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
    description:
      "Experience with SQL analytics, agile delivery, cross-functional collaboration, and stakeholder management.",
    parsedDescription: emptyParsedDescription,
    ...overrides,
  } as JobItem;
}

test("resolveJobMatchSkills: PM title scorable when dictionary empty", () => {
  const skills = resolveJobMatchSkills(minimalJob());
  assert.ok(skills.length >= MIN_JOB_MATCH_SIGNALS);
  assert.ok(
    skills.some(
      (s) =>
        s.source === "title_family" ||
        s.source === "role_hint" ||
        s.source === "description_fallback",
    ),
  );
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

test("jobHasResolvableMatchSignals: false when title and corpus lack signals", () => {
  assert.equal(
    jobHasResolvableMatchSignals(
      minimalJob({
        title: "Team Member",
        description: "",
        previewLines: [],
        parsedDescription: emptyParsedDescription,
      }),
    ),
    false,
  );
});

test("resolveJobMatchSkills: description fallback when parsed buckets empty", () => {
  const skills = resolveJobMatchSkills(
    minimalJob({
      title: "Operations Coordinator",
      parsedDescription: emptyParsedDescription,
      description:
        "Requirements include SQL reporting, agile project delivery, Jira tracking, and excel dashboards for operations.",
    }),
  );
  assert.ok(skills.length >= MIN_JOB_MATCH_SIGNALS);
  assert.ok(skills.some((s) => s.source === "description_fallback"));
});

test("isDescriptionFallbackKeyword: rejects generic JD prose tokens", () => {
  for (const word of [
    "spanning",
    "suites",
    "phases",
    "ranging",
    "decision",
    "dependencies",
    "discovery",
    "implement",
    "maintain",
    "integrated",
    "campaigns",
  ]) {
    assert.equal(isDescriptionFallbackKeyword(word), false, word);
  }
});

test("isDescriptionFallbackKeyword: accepts dictionary and allowlist skills", () => {
  assert.equal(isDescriptionFallbackKeyword("python"), true);
  assert.equal(isDescriptionFallbackKeyword("sql"), true);
  assert.equal(isDescriptionFallbackKeyword("machine learning"), true);
});

test("resolveJobMatchSkills: description fallback skips generic prose gaps", () => {
  const skills = resolveJobMatchSkills(
    minimalJob({
      title: "Machine Learning Engineer",
      parsedDescription: emptyParsedDescription,
      description:
        "Design evaluation pipelines spanning offline model evaluation, simulation suites, and on-road regression releases. Requires Python, SQL, and Linux.",
    }),
  );
  const canonicals = skills.map((s) => s.canonical);
  assert.ok(skills.length >= MIN_JOB_MATCH_SIGNALS);
  assert.ok(canonicals.includes("python"));
  assert.ok(!canonicals.includes("spanning"));
  assert.ok(!canonicals.includes("suites"));
  assert.ok(!canonicals.includes("phases"));
});
