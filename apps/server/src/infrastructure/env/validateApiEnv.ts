/**
 * Validates environment required for the HTTP API process (Fastify).
 * Workers validate their own needs via queue/redis constructors.
 */

export type ApiProcessEnv = {
  databaseUrl: string;
  port: number;
};

function isValidPort(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

/**
 * Throws if required vars are missing or invalid. Call after `loadRootEnv()`.
 */
export function assertApiProcessEnv(): ApiProcessEnv {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the API server (set in repo root .env)");
  }
  if (databaseUrl.length < 8) {
    throw new Error("DATABASE_URL looks invalid (too short)");
  }

  const rawPort = process.env.PORT;
  const port =
    rawPort !== undefined && rawPort !== "" ? Number.parseInt(rawPort, 10) : 3000;
  if (!isValidPort(port)) {
    throw new Error(`PORT must be an integer 1–65535 (got ${String(rawPort)})`);
  }

  return { databaseUrl, port };
}
