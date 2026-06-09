import test from "node:test";
import assert from "node:assert/strict";
import type { JobItem } from "./api";
import {
  applyTitleMismatchCap,
  computeTitleFit,
  computeTitleFitScore,
  deriveCandidateRoleFamily,
  deriveJobRoleFamily,
} from "./resumeFitTitle";

function job(overrides: Partial<JobItem> = {}): JobItem {
  return {
    id: "job-title-1",
    title: "Software Engineer",
    company: { id: "c", name: "Co", slug: "co" },
    location: "Remote",
    role: "engineering",
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
    ...overrides,
  } as JobItem;
}

test("deriveCandidateRoleFamily: backend engineer", () => {
  const result = deriveCandidateRoleFamily({ currentTitle: "Senior Backend Engineer" });
  assert.equal(result.family, "engineering.backend");
});

test("deriveJobRoleFamily: sales executive", () => {
  const result = deriveJobRoleFamily(job({ title: "Sales Executive", category: "sales" }));
  assert.equal(result.family, "sales");
});

test("computeTitleFitScore matrix", () => {
  assert.equal(computeTitleFitScore("engineering.backend", "engineering.backend"), 100);
  assert.equal(computeTitleFitScore("engineering.backend", "software.engineering"), 80);
  assert.equal(computeTitleFitScore("engineering.backend", "engineering.devops"), 60);
  assert.equal(computeTitleFitScore("engineering.backend", "recruiting"), 25);
});

test("Phase 6 taxonomy: software vs technical/mechanical", () => {
  assert.equal(computeTitleFitScore("software.engineering", "software.engineering"), 100);
  assert.equal(computeTitleFitScore("software.engineering", "technical.operations"), 40);
  assert.equal(computeTitleFitScore("software.engineering", "mechanical.engineering"), 25);
  assert.equal(computeTitleFitScore("technical.operations", "mechanical.engineering"), 60);
});

test("deriveJobRoleFamily: spacecraft technician is technical.operations", () => {
  const result = deriveJobRoleFamily(job({ title: "Spacecraft Technician", category: "engineering" }));
  assert.equal(result.family, "technical.operations");
});

test("deriveJobRoleFamily: engineering category alone maps to other", () => {
  const result = deriveJobRoleFamily(job({ title: "Project Estimator", category: "engineering" }));
  assert.equal(result.family, "other");
});

test("deriveCandidateRoleFamily: software engineer", () => {
  const result = deriveCandidateRoleFamily({ currentTitle: "Senior Software Engineer" });
  assert.equal(result.family, "software.engineering");
});

test("cross-family mismatch examples", () => {
  const backendToSales = computeTitleFit(
    job({ title: "Sales Engineer" }),
    { currentTitle: "Backend Engineer" },
  );
  assert.equal(backendToSales.titleFitScore, 25);

  const recruiterToCsm = computeTitleFit(
    job({ title: "Customer Success Manager", category: "customer-support" }),
    { currentTitle: "Senior Recruiter" },
  );
  assert.equal(recruiterToCsm.titleFitScore, 25);

  const pmToEngineer = computeTitleFit(
    job({ title: "Software Engineer", category: "engineering" }),
    { currentTitle: "Product Manager" },
  );
  assert.equal(pmToEngineer.titleFitScore, 25);
});

test("applyTitleMismatchCap on different families", () => {
  const fit = computeTitleFit(job({ title: "Sales Engineer", category: "sales" }), {
    currentTitle: "Backend Engineer",
  });
  const capped = applyTitleMismatchCap(72, fit);
  assert.equal(capped.cap, 45);
  assert.equal(capped.score, 45);
});
