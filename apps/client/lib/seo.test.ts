import test from "node:test";
import assert from "node:assert/strict";
import { buildJobsSeo, formatJobDiscoveryBreadcrumbLabel } from "./seo";

function withV2(run: () => void): void {
  const prev = process.env.SEO_TITLE_TEMPLATE;
  delete process.env.SEO_TITLE_TEMPLATE;
  try {
    run();
  } finally {
    if (prev === undefined) delete process.env.SEO_TITLE_TEMPLATE;
    else process.env.SEO_TITLE_TEMPLATE = prev;
  }
}

function withLegacy(run: () => void): void {
  const prev = process.env.SEO_TITLE_TEMPLATE;
  process.env.SEO_TITLE_TEMPLATE = "legacy";
  try {
    run();
  } finally {
    if (prev === undefined) delete process.env.SEO_TITLE_TEMPLATE;
    else process.env.SEO_TITLE_TEMPLATE = prev;
  }
}

test("buildJobsSeo v2: count + Remote + role + USA + Hiring now", () => {
  withV2(() => {
    const { title, description } = buildJobsSeo(
      {
        role: "backend-developer",
        country: "US",
        workType: "remote",
        surface: "seo",
      },
      1243,
    );
    assert.match(title, /1,243/);
    assert.match(title, /Remote Backend Developer Jobs in USA/i);
    assert.match(title, /Hiring now/i);
    assert.match(description, /1,243/);
    assert.match(description, /actively hiring/i);
  });
});

test("buildJobsSeo v2: total zero uses Explore, no Hiring now", () => {
  withV2(() => {
    const { title, description } = buildJobsSeo(
      {
        role: "backend-developer",
        country: "US",
        workType: "remote",
        surface: "seo",
      },
      0,
    );
    assert.match(title, /Explore/i);
    assert.doesNotMatch(title, /Hiring now/i);
    assert.match(description, /Explore/i);
  });
});

test("buildJobsSeo v2: unknown total uses Discover, no numeric prefix", () => {
  withV2(() => {
    const { title } = buildJobsSeo({
      role: "data-engineer",
      surface: "seo",
    });
    assert.match(title, /Discover/i);
    assert.match(title, /Data Engineer/i);
    assert.doesNotMatch(title, /^[\d,]+\s/);
  });
});

test("buildJobsSeo v2: minSalary adds From $ fragment when space allows", () => {
  withV2(() => {
    const { title } = buildJobsSeo(
      {
        role: "engineer",
        country: "US",
        minSalary: 120000,
        surface: "seo",
      },
      50,
    );
    assert.match(title, /From \$120k/i);
  });
});

test("buildJobsSeo v2: page 2 appends before brand", () => {
  withV2(() => {
    const { title } = buildJobsSeo(
      {
        role: "frontend-engineer",
        country: "IN",
        page: 2,
        surface: "seo",
      },
      100,
    );
    assert.match(title, /· Page 2\s*\|\s*JobLoom$/i);
  });
});

test("buildJobsSeo legacy: retains Hiring Now (Updated Daily)", () => {
  withLegacy(() => {
    const { title } = buildJobsSeo({ role: "backend-developer", surface: "seo" }, 10);
    assert.match(title, /Hiring Now \(Updated Daily\)/);
  });
});

test("formatJobDiscoveryBreadcrumbLabel strips JobLoom and Hiring now", () => {
  withV2(() => {
    const label = formatJobDiscoveryBreadcrumbLabel({
      role: "backend-developer",
      country: "US",
      workType: "remote",
      surface: "seo",
    });
    assert.doesNotMatch(label, /JobLoom/i);
    assert.doesNotMatch(label, /Hiring now/i);
  });
});
