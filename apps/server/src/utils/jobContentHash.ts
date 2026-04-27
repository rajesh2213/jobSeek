import { createHash } from "node:crypto";

function normalizeForHash(input: string | null | undefined): string {
  if (!input) return "";
  return input.trim().replace(/\s+/g, " ").toLowerCase();
}

export function computeJobContentHash(input: {
  title: string;
  description?: string | null;
  applyUrl?: string | null;
}): string {
  const normalizedDescription = normalizeForHash(input.description).slice(0, 2000);
  const payload = [
    normalizeForHash(input.title),
    normalizedDescription,
    normalizeForHash(input.applyUrl),
  ].join("|");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
