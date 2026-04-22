import test from "node:test";
import assert from "node:assert/strict";
import {
  DICTIONARY_VERSION,
  getCanonicalFromToken,
  getCanonicalsFromRequirementLine,
  normalizeLineForSkillScan,
  getSkillDisplayLabel,
} from "./index";

test("getCanonicalFromToken maps common aliases", () => {
  assert.equal(getCanonicalFromToken("Postgres"), "postgresql");
  assert.equal(getCanonicalFromToken("node"), "nodejs");
  assert.equal(getCanonicalFromToken("notatechnologyword"), null);
});

test("getCanonicalsFromRequirementLine: phrase then token", () => {
  const a = getCanonicalsFromRequirementLine("Experience with Amazon Web Services and Docker");
  const aws = a.find((x) => x.canonical === "aws");
  const docker = a.find((x) => x.canonical === "docker");
  assert.equal(aws?.matchedBy, "phrase");
  assert.equal(docker?.matchedBy, "token");
});

test("getCanonicalsFromRequirementLine: node.js → nodejs", () => {
  const a = getCanonicalsFromRequirementLine("We use node.js for services");
  assert.ok(a.some((x) => x.canonical === "nodejs"));
});

test("getCanonicalsFromRequirementLine: google cloud platform", () => {
  const a = getCanonicalsFromRequirementLine("Deploy on Google Cloud Platform");
  assert.ok(a.some((x) => x.canonical === "gcp" && x.matchedBy === "phrase"));
});

test("DICTIONARY_VERSION is stable and non-empty", () => {
  assert.ok(DICTIONARY_VERSION.length > 4);
  assert.equal(DICTIONARY_VERSION, DICTIONARY_VERSION);
});

test("getSkillDisplayLabel for enrichment-backed canonical", () => {
  assert.equal(getSkillDisplayLabel("csharp"), "C#");
});

test("normalizeLineForSkillScan", () => {
  assert.equal(normalizeLineForSkillScan("  Foo   bar.baz! "), "foo bar baz");
});
