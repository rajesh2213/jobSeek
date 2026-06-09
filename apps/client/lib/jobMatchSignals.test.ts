import test from "node:test";
import assert from "node:assert/strict";
import type { JobItem } from "./api";
import {
  MIN_JOB_MATCH_SIGNALS,
  isDescriptionFallbackKeyword,
  jobHasResolvableMatchSignals,
  matchTitleFamilyLowPack,
  resolveJobMatchSkills,
  resolveJobMatchSkillsWithMeta,
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

test("resolveJobMatchSkills: parsed requirements do not emit generic prose tokens", () => {
  const skills = resolveJobMatchSkills(
    minimalJob({
      title: "Operations Coordinator",
      parsedDescription: {
        ...emptyParsedDescription,
        requirement: [
          "Seeking a senior contributor who combines practical expertise with scalable workflows and business execution.",
        ],
      },
      description: "",
      previewLines: [],
    }),
  );
  const canonicals = skills.map((s) => s.canonical);
  assert.ok(!canonicals.includes("contributor"));
  assert.ok(!canonicals.includes("seeking"));
  assert.ok(!canonicals.includes("combines"));
});

test("resolveJobMatchSkills: Senior AI Engineer scorable on list-shaped payload", () => {
  const skills = resolveJobMatchSkills(
    minimalJob({
      title: "Senior AI Engineer",
      role: "engineering",
      skills: [],
      description: null,
      previewLines: [
        "Cloudinary is seeking a Senior AI Engineer to drive automation, integrations, and AI enablement across the organization.",
      ],
      parsedDescription: {
        ...emptyParsedDescription,
        requirement: [
          "Drive automation and AI enablement",
          "Design scalable integrations",
          "Python and cloud experience preferred",
        ],
      },
    }),
  );
  assert.ok(skills.length >= MIN_JOB_MATCH_SIGNALS);
  assert.ok(skills.some((s) => s.canonical === "python" || s.source === "title_family"));
  assert.ok(!skills.some((s) => s.canonical === "contributor" || s.canonical === "enablement"));
});

test("resolveJobMatchSkills: tier 3.5 low-confidence recovery for Mine Designer", () => {
  const resolution = resolveJobMatchSkillsWithMeta(
    minimalJob({
      title: "Mine Designer",
      role: null,
      description:
        "This position is based in Western Australia. Applicants should review the full posting for scope and expectations.",
      parsedDescription: {
        ...emptyParsedDescription,
        requirement: [
          "Seeking a senior contributor who combines practical expertise with scalable workflows.",
        ],
      },
      previewLines: [],
    }),
  );
  assert.equal(resolution.fitTier, 4);
  assert.equal(resolution.confidence, "low");
  assert.ok(resolution.skills.length >= MIN_JOB_MATCH_SIGNALS);
  assert.ok(resolution.skills.every((s) => s.source === "title_family_low"));
  assert.ok(resolution.skills.some((s) => s.canonical === "design"));
  assert.ok(!resolution.skills.some((s) => s.canonical === "contributor"));
});

test("scoreResume: title_family_low signals never appear as missing gaps", async () => {
  const { scoreResume, clearScoreCache } = await import("./resumeScorer");
  clearScoreCache();
  const result = scoreResume(
    "Experienced program manager with stakeholder communication skills.",
    [],
    minimalJob({
      title: "Mine Designer",
      role: null,
      description:
        "This position is based in Western Australia. Applicants should review the full posting for scope and expectations.",
      parsedDescription: emptyParsedDescription,
      previewLines: [],
    }),
  );
  assert.equal(result.fitTier, 4);
  assert.equal(result.missing.length, 0);
});

test("matchTitleFamilyLowPack: Physical Therapist and Account Executive families", () => {
  const pt = matchTitleFamilyLowPack(
    minimalJob({ title: "Physical Therapist", description: "Provide patient care in outpatient clinic." }),
  );
  assert.equal(pt?.family, "healthcare.therapy");
  assert.ok(pt?.skills.includes("rehabilitation"));

  const ae = matchTitleFamilyLowPack(
    minimalJob({ title: "Account Executive", description: "Own enterprise sales pipeline and CRM hygiene." }),
  );
  assert.equal(ae?.family, "sales.account_executive");
  assert.ok(ae?.skills.includes("negotiation"));
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
