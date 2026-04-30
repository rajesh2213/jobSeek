/**
 * Load repo-root `.env` with override so admin scripts match `npm run dev` even when the shell
 * already exports stale REDIS_URL / DATABASE_URL (dotenv default does not override).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const envPath = path.join(repoRoot, ".env");

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: true });
}
