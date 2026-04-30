import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export function loadRootEnv(): void {
  const currentFile = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(currentFile), "../../../../../");
  const envPath = path.join(repoRoot, ".env");

  if (!fs.existsSync(envPath)) return;

  // Ensure repo-root .env is authoritative for local dev regardless of stale shell env.
  dotenv.config({ path: envPath, override: true });
}

