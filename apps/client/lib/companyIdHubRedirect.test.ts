import assert from "node:assert/strict";
import test from "node:test";
import { buildCompanyHubRedirectPath } from "./companyIdHubRedirect";
import type { JobFilters } from "./slug-parser";

test("buildCompanyHubRedirectPath strips companyId and pagination", () => {
  const path = buildCompanyHubRedirectPath("acme-corp", {
    companyId: "uuid-1",
    page: 2,
    limit: 50,
    offset: 20,
    surface: "seo",
  });
  assert.equal(path, "/company/acme-corp");
});

test("buildCompanyHubRedirectPath preserves role", () => {
  const path = buildCompanyHubRedirectPath("acme-corp", {
    companyId: "uuid-1",
    role: "engineering",
    roles: ["engineering"],
  });
  assert.ok(path.startsWith("/company/acme-corp?"));
  assert.ok(path.includes("role=engineering"));
});

test("buildCompanyHubRedirectPath preserves skill filters", () => {
  const path = buildCompanyHubRedirectPath("acme-corp", {
    companyId: "uuid-1",
    skills: ["react"],
  });
  assert.equal(path, "/company/acme-corp?skills=react");
});

test("buildCompanyHubRedirectPath preserves compound hub filters", () => {
  const filters: JobFilters = {
    companyId: "uuid-1",
    role: "engineering",
    skills: ["react"],
    isRemote: true,
    country: "US",
    minSalary: 120000,
    page: 3,
  };
  const path = buildCompanyHubRedirectPath("acme-corp", filters);
  assert.ok(path.startsWith("/company/acme-corp?"));
  assert.ok(path.includes("role=engineering"));
  assert.ok(path.includes("skills=react"));
  assert.ok(path.includes("remote=true"));
  assert.ok(path.includes("country=US"));
  assert.ok(path.includes("minSalary=120000"));
  assert.ok(!path.includes("companyId"));
  assert.ok(!path.includes("page="));
});
