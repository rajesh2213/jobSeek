/**
 * Tune per-process Prisma pool size so API traffic is not starved by ~30 BullMQ workers.
 * Total Supabase connections ≈ sum(connection_limit) across all Node processes.
 */
export function resolvePrismaDatasourceUrl(): string | undefined {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) return undefined;

  const workerName = process.env.WORKER_NAME?.trim() ?? "";
  const isApi = workerName === "jobseek-api";
  const envLimit = Number.parseInt(process.env.PRISMA_CONNECTION_LIMIT ?? "", 10);
  const defaultLimit = isApi ? 4 : 1;
  const limit =
    Number.isFinite(envLimit) && envLimit >= 1
      ? Math.min(envLimit, isApi ? 10 : 2)
      : defaultLimit;

  try {
    const u = new URL(raw);
    u.searchParams.set("connection_limit", String(limit));
    u.searchParams.set("pool_timeout", isApi ? "20" : "10");
    u.searchParams.set("connect_timeout", "10");
    return u.toString();
  } catch {
    return raw;
  }
}
