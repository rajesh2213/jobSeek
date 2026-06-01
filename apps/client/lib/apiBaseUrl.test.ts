import test from "node:test";
import assert from "node:assert/strict";
import { resolveApiBaseUrl } from "./apiBaseUrl";

test("resolveApiBaseUrl prefers API_BASE_URL on server", () => {
  const prevPublic = process.env.NEXT_PUBLIC_API_BASE_URL;
  const prevApi = process.env.API_BASE_URL;
  try {
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://stale.example.com";
    process.env.API_BASE_URL = "https://api.example.com";
    assert.equal(resolveApiBaseUrl(), "https://api.example.com");
  } finally {
    if (prevPublic === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL;
    else process.env.NEXT_PUBLIC_API_BASE_URL = prevPublic;
    if (prevApi === undefined) delete process.env.API_BASE_URL;
    else process.env.API_BASE_URL = prevApi;
  }
});
