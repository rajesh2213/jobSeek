import type { PrismaClient } from "@prisma/client";

/**
 * Read-only snapshots for spike triage (pg_stat_activity). Safe to call from internal routes / CLI.
 * Through PgBouncer, rows may reflect the pooler or limited stats — see runbook.
 */
export type DbActivitySnapshot = {
  generatedAt: string;
  /** Grouped counts by session state / wait. */
  summary: Array<{
    state: string | null;
    wait_event_type: string | null;
    wait_event: string | null;
    n: string;
  }>;
  /** Non-idle backends (truncated query text). */
  activeSamples: Array<{
    pid: string;
    usename: string | null;
    application_name: string | null;
    client_addr: string | null;
    state: string | null;
    wait_event_type: string | null;
    wait_event: string | null;
    ageSeconds: number | null;
    queryPreview: string | null;
  }>;
  /** Longest running queries among sampled (by age). */
  longestIdleInTransaction: Array<{
    pid: string;
    state: string | null;
    ageSeconds: number | null;
    queryPreview: string | null;
  }>;
};

function bigintToString(v: bigint | number | null | undefined): string {
  if (v == null) return "0";
  return String(v);
}

export async function buildDbActivitySnapshot(prisma: PrismaClient): Promise<DbActivitySnapshot> {
  const summary = await prisma.$queryRaw<
    Array<{
      state: string | null;
      wait_event_type: string | null;
      wait_event: string | null;
      n: bigint;
    }>
  >`
    SELECT state, wait_event_type, wait_event, count(*)::bigint AS n
    FROM pg_stat_activity
    WHERE datname = current_database()
    GROUP BY 1, 2, 3
    ORDER BY n DESC
  `;

  const activeSamples = await prisma.$queryRaw<
    Array<{
      pid: number;
      usename: string | null;
      application_name: string | null;
      client_addr: string | null;
      state: string | null;
      wait_event_type: string | null;
      wait_event: string | null;
      age_seconds: number | null;
      query_preview: string | null;
    }>
  >`
    SELECT
      pid,
      usename,
      application_name,
      client_addr::text AS client_addr,
      state,
      wait_event_type,
      wait_event,
      EXTRACT(EPOCH FROM (clock_timestamp() - query_start))::float AS age_seconds,
      LEFT(query, 160) AS query_preview
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND state <> 'idle'
    ORDER BY query_start NULLS LAST
    LIMIT 30
  `;

  const longestIdleInTransaction = await prisma.$queryRaw<
    Array<{
      pid: number;
      state: string | null;
      age_seconds: number | null;
      query_preview: string | null;
    }>
  >`
    SELECT
      pid,
      state,
      EXTRACT(EPOCH FROM (clock_timestamp() - xact_start))::float AS age_seconds,
      LEFT(query, 160) AS query_preview
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND state = 'idle in transaction'
    ORDER BY xact_start NULLS LAST
    LIMIT 15
  `;

  return {
    generatedAt: new Date().toISOString(),
    summary: summary.map((r) => ({
      state: r.state,
      wait_event_type: r.wait_event_type,
      wait_event: r.wait_event,
      n: bigintToString(r.n),
    })),
    activeSamples: activeSamples.map((r) => ({
      pid: String(r.pid),
      usename: r.usename,
      application_name: r.application_name,
      client_addr: r.client_addr,
      state: r.state,
      wait_event_type: r.wait_event_type,
      wait_event: r.wait_event,
      ageSeconds: r.age_seconds,
      queryPreview: r.query_preview,
    })),
    longestIdleInTransaction: longestIdleInTransaction.map((r) => ({
      pid: String(r.pid),
      state: r.state,
      ageSeconds: r.age_seconds,
      queryPreview: r.query_preview,
    })),
  };
}
