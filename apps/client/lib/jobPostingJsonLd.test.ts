import assert from "node:assert/strict";
import test from "node:test";
import {
  buildJobPostingJsonLd,
  resolveJobPostingDatePosted,
  shouldEmitJobPostingJsonLd,
} from "./jobPostingJsonLd";
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

test("resolveJobPostingDatePosted uses freshness POSTED timestamp", () => {
  const job = sampleJob({
    postedAt: "2026-04-15T00:00:00.000Z",
    freshness: {
      source: "POSTED",
      label: "Posted",
      timestamp: "2026-04-15T00:00:00.000Z",
      relative: "Posted 1 day ago",
    },
  });
  assert.equal(resolveJobPostingDatePosted(job), "2026-04-15T00:00:00.000Z");
});

test("DISCOVERED-only jobs emit JobPosting JSON-LD via effectivePostedAt fallback", () => {
  const job = sampleJob({
    postedAt: null,
    freshness: {
      source: "DISCOVERED",
      label: "Added",
      timestamp: "2026-05-12T06:57:21.746Z",
      relative: "Added 1 day ago",
    },
    effectivePostedAt: "2026-05-12T06:57:21.746Z",
  });
  assert.equal(shouldEmitJobPostingJsonLd(job, "Readable role details."), true);
  assert.equal(resolveJobPostingDatePosted(job), "2026-05-12T06:57:21.746Z");
});

test("POSTED jobs emit datePosted and validThrough", () => {
  const job = sampleJob({
    isActive: true,
    expiresAt: "2026-12-31T00:00:00.000Z",
    postedAt: "2026-04-15T00:00:00.000Z",
    freshness: {
      source: "POSTED",
      label: "Posted",
      timestamp: "2026-04-15T00:00:00.000Z",
      relative: "Posted 1 day ago",
    },
  });
  assert.equal(shouldEmitJobPostingJsonLd(job, undefined), true);
  const jsonLd = buildJobPostingJsonLd(job, undefined);
  assert.equal(jsonLd.datePosted, "2026-04-15T00:00:00.000Z");
  assert.equal(jsonLd.validThrough, "2026-05-30T00:00:00.000Z");
});

test("inactive jobs omit JobPosting JSON-LD", () => {
  const job = sampleJob({
    isActive: false,
    expiresAt: "2026-12-31T00:00:00.000Z",
    postedAt: "2026-04-15T00:00:00.000Z",
    freshness: {
      source: "POSTED",
      label: "Posted",
      timestamp: "2026-04-15T00:00:00.000Z",
      relative: "Posted 1 day ago",
    },
  });
  assert.equal(shouldEmitJobPostingJsonLd(job, "Readable role details."), false);
});

test("expired jobs omit JobPosting JSON-LD", () => {
  const job = sampleJob({
    isActive: true,
    expiresAt: "2020-01-01T00:00:00.000Z",
    postedAt: "2026-04-15T00:00:00.000Z",
    freshness: {
      source: "POSTED",
      label: "Posted",
      timestamp: "2026-04-15T00:00:00.000Z",
      relative: "Posted 1 day ago",
    },
  });
  assert.equal(shouldEmitJobPostingJsonLd(job, "Readable role details."), false);
});

test("capped path still emits description via structuredDataDescription fallback", () => {
  const job = sampleJob({
    description: null,
    structuredDataDescription: "Capped-safe structured data description.",
    postedAt: "2026-04-15T00:00:00.000Z",
    freshness: {
      source: "POSTED",
      label: "Posted",
      timestamp: "2026-04-15T00:00:00.000Z",
      relative: "Posted 1 day ago",
    },
  });
  const jsonLd = buildJobPostingJsonLd(job, job.structuredDataDescription ?? undefined);
  assert.equal(jsonLd.description, "Capped-safe structured data description.");
});

test("remote jobs without country still emit applicantLocationRequirements", () => {
  const job = sampleJob({
    country: "",
    locationCountry: "",
    isRemote: true,
    workType: "remote",
    postedAt: "2026-04-15T00:00:00.000Z",
    freshness: {
      source: "POSTED",
      label: "Posted",
      timestamp: "2026-04-15T00:00:00.000Z",
      relative: "Posted 1 day ago",
    },
  });
  const jsonLd = buildJobPostingJsonLd(job, "Role details.");
  assert.equal(jsonLd.jobLocationType, "TELECOMMUTE");
  assert.deepEqual(jsonLd.applicantLocationRequirements, {
    "@type": "Country",
    name: "US",
  });
});

test("buildJobPostingJsonLd includes address and salary range when present", () => {
  const job = sampleJob({
    locationCity: "San Francisco",
    locationState: "CA",
    locationCountry: "US",
    country: "US",
    salaryMin: 120000,
    salaryMax: 160000,
    postedAt: "2026-04-15T00:00:00.000Z",
    freshness: {
      source: "POSTED",
      label: "Posted",
      timestamp: "2026-04-15T00:00:00.000Z",
      relative: "Posted 1 day ago",
    },
  });
  const jsonLd = buildJobPostingJsonLd(job, "Role details.");
  const address = (jsonLd.jobLocation as { address: Record<string, unknown> }).address;
  assert.equal(address.addressLocality, "San Francisco");
  assert.equal(address.addressRegion, "CA");
  assert.equal(address.addressCountry, "US");
  const value = (jsonLd.baseSalary as { value: Record<string, unknown> }).value;
  assert.equal(value.minValue, 120000);
  assert.equal(value.maxValue, 160000);
});
