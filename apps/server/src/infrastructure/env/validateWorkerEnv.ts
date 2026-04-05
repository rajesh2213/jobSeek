/**
 * Workers require database + Redis. Call after `loadRootEnv()`.
 */

export function assertWorkerProcessEnv(): void {
  const db = process.env.DATABASE_URL?.trim();
  if (!db) {
    throw new Error("DATABASE_URL is required for BullMQ workers (set in repo root .env)");
  }
  const redis = process.env.REDIS_URL?.trim();
  if (!redis) {
    throw new Error("REDIS_URL is required for BullMQ workers (set in repo root .env)");
  }
}
