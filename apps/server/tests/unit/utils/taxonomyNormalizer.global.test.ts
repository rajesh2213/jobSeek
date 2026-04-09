import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeJobAttributes } from "../../../src/utils/taxonomyNormalizer.js";

describe("normalizeJobAttributes remote + no resolved country → GLOBAL", () => {
  it("marks plain remote role with empty location as GLOBAL", () => {
    const r = normalizeJobAttributes({
      title: "Software Engineer",
      description: "",
      location: "",
      isRemote: true,
    });
    assert.equal(r.country, "GLOBAL");
    assert.equal(r.isRemote, true);
  });

  it('marks location "Remote" as GLOBAL when no country resolves', () => {
    const r = normalizeJobAttributes({
      title: "Developer",
      location: "Remote",
      isRemote: true,
    });
    assert.equal(r.country, "GLOBAL");
  });

  it('marks location "Fully remote" as GLOBAL', () => {
    const r = normalizeJobAttributes({
      title: "Developer",
      location: "Fully remote",
      isRemote: true,
    });
    assert.equal(r.country, "GLOBAL");
  });

  it("does not override resolved US from Remote - US", () => {
    const r = normalizeJobAttributes({
      title: "Developer",
      location: "Remote - US",
      isRemote: true,
    });
    assert.equal(r.country, "US");
  });

  it("does not use GLOBAL when raw location is multi-site (semicolon)", () => {
    const r = normalizeJobAttributes({
      title: "Developer",
      location: "San Francisco; London",
      isRemote: true,
    });
    assert.notEqual(r.country, "GLOBAL");
  });

  it("does not use GLOBAL when raw location uses pipe separator", () => {
    const r = normalizeJobAttributes({
      title: "Developer",
      location: "Berlin | Paris",
      isRemote: true,
    });
    assert.notEqual(r.country, "GLOBAL");
  });

  it("does not use GLOBAL when title implies Europe restriction", () => {
    const r = normalizeJobAttributes({
      title: "Remote role (Europe)",
      isRemote: true,
    });
    assert.notEqual(r.country, "GLOBAL");
  });

  it("does not use GLOBAL when description mentions US hiring restriction", () => {
    const r = normalizeJobAttributes({
      title: "Engineer",
      description: "Must be in the US for legal reasons.",
      isRemote: true,
    });
    assert.notEqual(r.country, "GLOBAL");
  });

  it("keeps structured US location when resolved", () => {
    const r = normalizeJobAttributes({
      title: "Developer",
      location: "San Francisco, CA",
      isRemote: true,
    });
    assert.equal(r.country, "US");
    assert.equal(r.city, "San Francisco");
  });

  it("does not assign GLOBAL when job is not remote", () => {
    const r = normalizeJobAttributes({
      title: "Software Engineer",
      location: "",
      isRemote: false,
    });
    assert.notEqual(r.country, "GLOBAL");
  });
});
