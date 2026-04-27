import { createHash } from "node:crypto";
import { normalizeJobUrl } from "./normalizeJobUrl.js";

function normalizeCacheKeyInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  // Collapse semantically equivalent URL variants (slash/query/hash/case).
  return normalizeJobUrl(trimmed);
}

export function hashedCacheKey(namespace: string, raw: string): string {
  const digest = createHash("sha1")
    .update(normalizeCacheKeyInput(raw), "utf8")
    .digest("hex");
  return `${namespace}:${digest}`;
}

