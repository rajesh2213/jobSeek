import test from "node:test";
import assert from "node:assert/strict";
import {
  similarCanonicals,
  clusterMissingJobSkills,
  computeSofterMissingMass,
  computeSofterScorePercent,
  computeMatchBonus,
} from "./resumeScoreSoftening";
import type { JobSkill } from "./skillExtractor";

const js = (canonical: string, w: number, source: JobSkill["source"] = "parsed_requirement"): JobSkill => ({
  canonical,
  source,
  weight: w,
});

test("similarCanonicals: no short-pair false positive (rust / rest)", () => {
  assert.equal(similarCanonicals("rust", "rest"), false);
});

test("similarCanonicals: Levenshtein only when min length >= 6", () => {
  assert.equal(similarCanonicals("rust", "rest"), false);
  assert.equal(similarCanonicals("abcdef", "abcdeg"), true);
});

test("clusterMissingJobSkills: aws+awssdk one cluster, sdk separate", () => {
  const missing: JobSkill[] = [js("awssdk", 0.7), js("aws", 0.7), js("sdk", 0.7)];
  const clusters = clusterMissingJobSkills(missing);
  assert.equal(clusters.length, 2);
  const pair = clusters.find((c) => c.length === 2);
  const solo = clusters.find((c) => c.length === 1);
  assert.ok(pair && solo);
  const names = (j: JobSkill[]) => j.map((x) => x.canonical).sort();
  assert.deepEqual(names(pair!), ["aws", "awssdk"]);
  assert.equal(solo![0]!.canonical, "sdk");
});

test("computeSofterScorePercent: totalW === 0 yields 0", () => {
  assert.equal(computeSofterScorePercent({ wMatched: 0, wPartial: 0, totalW: 0, adjustedMissingWeight: 0 }), 0);
});

test("computeSofterScorePercent: all matched, no missing (clamped to 100)", () => {
  const s = computeSofterScorePercent({ wMatched: 2, wPartial: 0, totalW: 2, adjustedMissingWeight: 0 });
  assert.equal(computeMatchBonus(2, 2), 0.1);
  assert.equal(s, 100);
});

test("computeSofterMissingMass: rawMissing is sum of original weights", () => {
  const missing: JobSkill[] = [js("a", 1.0, "taxonomy"), js("b", 0.7, "parsed_requirement")];
  const { rawMissingWeight } = computeSofterMissingMass(missing);
  assert.equal(rawMissingWeight, 1.7);
});
