import { test } from "node:test";
import assert from "node:assert/strict";
import { CompanyCrawlPriority } from "@prisma/client";
import {
  computeCompanyScore,
  priorityFromScore,
} from "../../../src/services/companyScore.service.js";

const now = new Date("2026-04-24T12:00:00.000Z");

test("computeCompanyScore: base + 48h success + jobs", () => {
  const lastOk = new Date(now.getTime() - 12 * 60 * 60 * 1000);
  const s = computeCompanyScore({
    atsType: "greenhouse",
    hasActiveEndpoint: true,
    lastIngestionSuccessAt: lastOk,
    canonicalJobsLast7d: 3,
    ingestionAttempts: 1,
    lastAttemptAt: lastOk,
    now,
  });
  assert.equal(s, 40 + 30 + 20 + 10);
});

test("computeCompanyScore: strong yield +10 and +15", () => {
  const lastOk = new Date(now.getTime() - 12 * 60 * 60 * 1000);
  const s = computeCompanyScore({
    atsType: "x",
    hasActiveEndpoint: false,
    lastIngestionSuccessAt: lastOk,
    canonicalJobsLast7d: 6,
    ingestionAttempts: 0,
    lastAttemptAt: lastOk,
    now,
  });
  assert.equal(s, 40 + 20 + 10 + 15);
});

test("computeCompanyScore: null lastIngestionSuccessAt is stale -20", () => {
  const lastAtt = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
  const s = computeCompanyScore({
    atsType: "x",
    hasActiveEndpoint: false,
    lastIngestionSuccessAt: null,
    canonicalJobsLast7d: 0,
    ingestionAttempts: 0,
    lastAttemptAt: lastAtt,
    now,
  });
  assert.equal(s, 40 - 20);
});

test("computeCompanyScore: attempts penalty when recent and no jobs", () => {
  const lastAtt = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
  const oldOk = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
  const s = computeCompanyScore({
    atsType: "x",
    hasActiveEndpoint: false,
    lastIngestionSuccessAt: oldOk,
    canonicalJobsLast7d: 0,
    ingestionAttempts: 6,
    lastAttemptAt: lastAtt,
    now,
  });
  // 40 -20 (stale >3d) -30 (attempts) => floor 0
  assert.equal(s, 0);
});

test("priorityFromScore bands", () => {
  assert.equal(priorityFromScore(80), CompanyCrawlPriority.high);
  assert.equal(priorityFromScore(50), CompanyCrawlPriority.medium);
  assert.equal(priorityFromScore(10), CompanyCrawlPriority.low);
});
