import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { loadOpenClawEnv } from "../../../../../src/modules/providers/providers/openclaw/openclaw.env.js";
import {
  extractJobsArray,
  mapOpenClawJobToNormalized,
  tryMapOpenClawJobToNormalized,
  coerceOpenClawListingUrl,
  OPENCLAW_MAX_TITLE_LEN,
  safeOpenClawPostedAt,
} from "../../../../../src/modules/providers/providers/openclaw/openclaw.mapper.js";
import { OpenClawClient } from "../../../../../src/modules/providers/providers/openclaw/openclaw.client.js";
import { tryConsumeOpenClawQuotaSlot } from "../../../../../src/modules/providers/providers/openclaw/openclaw.quota.js";
import { computeOpenClawCompanyHintPatch } from "../../../../../src/modules/providers/providers/openclaw/openclaw.sync.js";
import { getSourceQualityWeight } from "../../../../../src/services/jobRanking.service.js";
import type { Redis } from "ioredis";

function mockQuotaRedis(): Redis {
  return {
    incr: async () => 1,
    decr: async () => 0,
    pexpire: async () => 1,
  } as unknown as Redis;
}

/** Prisma loads `process.cwd()/.env` on import; clear all OpenClaw-related keys for isolated defaults. */
function deleteOpenClawEnvFromProcess(): void {
  delete process.env.RR_API_KEY;
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("OPENCLAW_")) delete process.env[key];
  }
}

describe("OpenClaw provider", () => {
test("loadOpenClawEnv: defaults keep provider off without throwing", () => {
  deleteOpenClawEnvFromProcess();
  const cfg = loadOpenClawEnv();
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.syncEnabled, false);
  assert.equal(cfg.dryRun, true);
  assert.equal(cfg.apiKey, null);
});

test("loadOpenClawEnv: parses flags", () => {
  deleteOpenClawEnvFromProcess();
  process.env.OPENCLAW_ENABLED = "true";
  process.env.OPENCLAW_SYNC_ENABLED = "true";
  process.env.OPENCLAW_API_KEY = "secret";
  process.env.OPENCLAW_MAX_REQUESTS_PER_DAY = "10";
  process.env.OPENCLAW_QUOTA_RESERVE = "2";
  const cfg = loadOpenClawEnv();
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.syncEnabled, true);
  assert.equal(cfg.apiKey, "secret");
  assert.equal(cfg.maxRequestsPerDay, 10);
  assert.equal(cfg.quotaReserve, 2);
  deleteOpenClawEnvFromProcess();
});

test("extractJobsArray: tolerates partial shapes", () => {
  assert.deepEqual(extractJobsArray(null), []);
  assert.deepEqual(extractJobsArray({ jobs: [{ title: "a" }] }), [{ title: "a" }]);
  assert.deepEqual(extractJobsArray([1, 2]), [1, 2]);
});

test("mapOpenClawJobToNormalized: maps minimal row", () => {
  const j = mapOpenClawJobToNormalized(
    { title: "Engineer", url: "https://example.com/j/1", company: { name: "Acme" } },
    "cid",
    "Acme",
  );
  assert.ok(j);
  assert.equal(j!.title, "Engineer");
  assert.equal(j!.source, "openclaw");
  assert.equal(j!.companyId, "cid");
});

test("mapOpenClawJobToNormalized: rejects malformed", () => {
  assert.equal(mapOpenClawJobToNormalized({ n: 1 }, "c", "x"), null);
});

test("tryMap: invalid listing URL", () => {
  const r = tryMapOpenClawJobToNormalized(
    { title: "T", url: "https://example.com/invalid-url/path" },
    "c",
    "Co",
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "invalid_listing_url");
});

test("tryMap: invalid apply URL rejects row", () => {
  const r = tryMapOpenClawJobToNormalized(
    { title: "T", url: "https://example.com/j/1", applyUrl: ":::" },
    "c",
    "Co",
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "invalid_apply_url");
});

test("tryMap: title length exceeded", () => {
  const r = tryMapOpenClawJobToNormalized(
    { title: "x".repeat(OPENCLAW_MAX_TITLE_LEN + 1), url: "https://example.com/j/1" },
    "c",
    "Co",
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "field_length_exceeded");
});

test("tryMap: giant description is truncated, still ok", () => {
  const huge = "d".repeat(250_000);
  const r = tryMapOpenClawJobToNormalized(
    { title: "T", url: "https://example.com/j/1", description: huge },
    "c",
    "Co",
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.ok((r.job.description?.length ?? 0) < huge.length);
});

test("coerceOpenClawListingUrl: accepts protocol-relative via https prefix", () => {
  const u = coerceOpenClawListingUrl("example.com/path");
  assert.ok(u?.startsWith("https://"));
});

test("safeOpenClawPostedAt: ignores absurd dates", () => {
  const r = { postedAt: 1 };
  assert.equal(safeOpenClawPostedAt(r, undefined), undefined);
});

test("getSourceQualityWeight: openclaw explicit", () => {
  assert.equal(getSourceQualityWeight("openclaw"), 0.62);
});

test("computeOpenClawCompanyHintPatch: fills empty only", () => {
  const p = computeOpenClawCompanyHintPatch(
    { domain: null, careersUrl: null, atsType: null, atsBoardToken: null },
    { domain: "acme.com", atsType: "greenhouse", atsBoardToken: "acme" },
  );
  assert.ok(p?.domain);
  assert.equal(p?.atsType, "greenhouse");
});

test("computeOpenClawCompanyHintPatch: skips ATS hints when trusted partial exists", () => {
  const p = computeOpenClawCompanyHintPatch(
    { domain: null, careersUrl: null, atsType: "greenhouse", atsBoardToken: null },
    { atsBoardToken: "intruder" },
  );
  assert.equal(p, null);
});

test("computeOpenClawCompanyHintPatch: skips ATS hints when token already set", () => {
  const p = computeOpenClawCompanyHintPatch(
    { domain: null, careersUrl: null, atsType: null, atsBoardToken: "tok" },
    { atsType: "lever", atsBoardToken: "x" },
  );
  assert.equal(p, null);
});

test("computeOpenClawCompanyHintPatch: never overwrites domain", () => {
  const p = computeOpenClawCompanyHintPatch(
    { domain: "existing.com", careersUrl: null, atsType: null, atsBoardToken: null },
    { domain: "other.com" },
  );
  assert.equal(p, null);
});

test("OpenClawClient: 401 does not throw and marks unauthorized", async () => {
  const prev = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("no", { status: 401, statusText: "Unauthorized" });

  const cfg = loadOpenClawEnv();
  const client = new OpenClawClient(
    {
      ...cfg,
      enabled: true,
      apiKey: "k",
      maxRequestsPerDay: 100,
      quotaReserve: 0,
      maxHttpRetries: 0,
      circuitFailureThreshold: 99,
      circuitCooldownMs: 1000,
    },
    () => mockQuotaRedis(),
  );

  const res = await client.fetchJobsSearch({ filters: { page: 1 } });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.kind, "unauthorized");

  globalThis.fetch = prev;
});

test("OpenClawClient: 503 then 200 retries", async () => {
  const prev = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async () => {
    n += 1;
    if (n === 1) return new Response("bad", { status: 503 });
    return new Response(JSON.stringify({ jobs: [] }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const cfg = loadOpenClawEnv();
  const client = new OpenClawClient(
    {
      ...cfg,
      enabled: true,
      apiKey: "k",
      maxRequestsPerDay: 100,
      quotaReserve: 0,
      maxHttpRetries: 2,
      circuitFailureThreshold: 99,
      circuitCooldownMs: 1000,
    },
    () => mockQuotaRedis(),
  );

  const res = await client.fetchJobsSearch({ filters: { page: 1 } });
  assert.equal(res.ok, true);
  assert.equal(n, 2);

  globalThis.fetch = prev;
});

test("OpenClawClient: quota blocked when Redis null (fail closed)", async () => {
  const prev = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });

  const cfg = loadOpenClawEnv();
  const client = new OpenClawClient(
    {
      ...cfg,
      enabled: true,
      apiKey: "k",
      maxRequestsPerDay: 100,
      quotaReserve: 0,
      maxHttpRetries: 0,
      circuitFailureThreshold: 99,
      circuitCooldownMs: 1000,
    },
    () => null,
  );

  const res = await client.fetchJobsSearch({ filters: { page: 1 } });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.kind, "quota_blocked");

  globalThis.fetch = prev;
});

test("tryConsumeOpenClawQuotaSlot: Redis unavailable → not allowed", async () => {
  const r = await tryConsumeOpenClawQuotaSlot(null, 100, 0);
  assert.equal(r.allowed, false);
  assert.equal(r.redisAvailable, false);
});
});
