import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export function loadRootEnv(): void {
  const currentFile = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(currentFile), "../../../../../");

  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.join(repoRoot, "apps", "server", ".env"),
    path.join(repoRoot, ".env"),
  ];

  const seen = new Set<string>();
  for (const envPath of candidates) {
    const resolved = path.resolve(envPath);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    if (!fs.existsSync(resolved)) continue;
    // Later files override earlier ones so repo-root `.env` wins over cwd-local copies.
    dotenv.config({ path: resolved, override: true });
  }
}

