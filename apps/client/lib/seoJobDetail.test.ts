import test from "node:test";
import assert from "node:assert/strict";
import type { JobItem } from "./api";
import { buildJobDetailSeo } from "./seoJobDetail";

function makeJob(overrides: Partial<JobItem>): JobItem {
  return {
    id: "j1",
    title: "Backend Developer",
    description: "Build APIs and services.",
    country: "US",
    locationCountry: "US",
    locationCity: "Austin",
    category: "engineering",
    isRemote: false,
    workType: "hybrid",
    role: "backend-developer",
    skills: [],
    salaryMin: 140000,
    sourceUrl: "https://example.com/job",
    postedAt: null,
    companyId: "c1",
    company: { id: "c1", name: "Acme Corp", slug: "acme-corp" },
    ...overrides,
  };
}

test("buildJobDetailSeo includes work mode, geo, salary, and brand", () => {
  const { title, description } = buildJobDetailSeo(makeJob({}), {
    plainDescriptionForSeo: "Own core services. Mentor engineers.",
  });
  assert.match(title, /Backend Developer at Acme Corp/i);
  assert.match(title, /Hybrid/i);
  assert.match(title, /United States|Austin/i);
  assert.match(title, /from \$140k/i);
  assert.match(title, /\|\s*JobLoom$/);
  assert.match(description, /Own core services/i);
});

test("buildJobDetailSeo POSTED freshness appends relative when room", () => {
  const { description } = buildJobDetailSeo(
    makeJob({
      freshness: {
        source: "POSTED",
        label: "Posted",
        timestamp: "2026-05-01T00:00:00.000Z",
        relative: "Posted 3 days ago",
      },
    }),
    { plainDescriptionForSeo: "Short desc." },
  );
  assert.match(description, /Posted 3 days ago/i);
});
