/** True when Supabase/PgBouncer or Prisma could not grant a connection in time. */
export function isDbPoolExhaustedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: string }).code ?? "")
      : "";
  return (
    code === "P2024" ||
    msg.includes("P2024") ||
    msg.includes("ECHECKOUTTIMEOUT") ||
    msg.includes("Timed out fetching a new connection") ||
    msg.includes("unable to check out connection from the pool")
  );
}
