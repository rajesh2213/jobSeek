import assert from "node:assert/strict";
import test from "node:test";
import { buildJobPostingJsonLd } from "./jobPostingJsonLd";
import type { JobItem } from "./api";

function sampleJob(overrides: Partial<JobItem> = {}): JobItem {
  return {
    id: "fdc770d3-6bcf-4999-b755-f533bc439029",
    title: "Senior Writing - Marketing",
    description: "Flat description body",
    structuredDataDescription: null,
    country: "MX",
    locationCountry: "MX",
    category: "marketing",
    isRemote: true,
    workType: "remote",
    role: "writer",
    skills: [],
    salaryMin: null,
    sourceUrl: "https://example.com/job/1",
    applyUrl: "https://example.com/apply/1",
    postedAt: null,
    effectivePostedAt: "2026-05-12T06:57:21.746Z",
    createdAt: "2026-05-12T06:57:21.746Z",
    companyId: "co_1",
    company: { id: "co_1", name: "Tribute Kiosk", slug: "tribute-kiosk", domain: "truelogic.io" },
    ...overrides,
  };
}

test("uncapped path includes description and datePosted fallback", () => {
  const job = sampleJob({ description: "Readable role details.", postedAt: null });
  const jsonLd = buildJobPostingJsonLd(job, job.description ?? undefined, "flat");
  assert.equal(jsonLd.description, "Readable role details.");
  assert.equal(jsonLd.datePosted, "2026-05-12T06:57:21.746Z");
});

test("capped path still emits description via structuredDataDescription fallback", () => {
  const job = sampleJob({
    description: null,
    structuredDataDescription: "Capped-safe structured data description.",
  });
  const jsonLdDescription =
    (job.description ?? undefined) || job.structuredDataDescription || undefined;
  const jsonLd = buildJobPostingJsonLd(job, jsonLdDescription, "flat");
  assert.equal(jsonLd.description, "Capped-safe structured data description.");
});

test("capped path uses structuredDataDescription when preferred is omitted", () => {
  const job = sampleJob({
    description: null,
    structuredDataDescription: "Resolver picks this without page wiring.",
  });
  const jsonLd = buildJobPostingJsonLd(job, undefined, "flat");
  assert.equal(jsonLd.description, "Resolver picks this without page wiring.");
});

test("remote job keeps applicantLocationRequirements and description", () => {
  const job = sampleJob({
    description: null,
    structuredDataDescription: "Remote role description",
    isRemote: true,
    workType: "remote",
    locationCountry: "MX",
  });
  const jsonLd = buildJobPostingJsonLd(
    job,
    job.structuredDataDescription ?? undefined,
    "structured",
  );
  assert.equal(jsonLd.jobLocationType, "TELECOMMUTE");
  assert.deepEqual(jsonLd.applicantLocationRequirements, { "@type": "Country", name: "MX" });
  assert.equal(jsonLd.description, "Remote role description");
});
