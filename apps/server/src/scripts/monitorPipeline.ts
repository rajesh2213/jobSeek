import { execSync } from "node:child_process";
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { getMonitorPipelineJournalSince } from "../utils/monitorJournalSince.js";

type QueueTrend = "increasing" | "decreasing" | "stable";
type SystemState = "healthy" | "degraded" | "idle";

type Report = {
  jobs_per_min: number;
  parse_calls_per_min: number;
  avg_latency: number;
  p95_latency: number;
  cache_hit_rate: number;
  duplicate_ratio: number;
  skip_rate: number;
  queue_wait_trend: QueueTrend;
  db_state: {
    active: number;
    idle: number;
    idle_in_transaction: number;
  };
  anomalies: string[];
  bottleneck: string;
  system_state: SystemState;
  recommendation: string;
};

type EventEnvelope = {
  MESSAGE?: string;
};

type EventLog = {
  event?: string;
  durationMs?: number;
  hit?: boolean;
  jobsPerMinApprox?: number;
  wait?: number;
  /** Enqueue-time Redis `job:seen` skip (`recentJobSeen.service` dedupe_decision). */
  seen?: boolean;
};

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

function round(value: number, digits = 4): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseJournalEvents(): EventLog[] {
  const since = getMonitorPipelineJournalSince();
  const out = execSync(
    `journalctl -u jobseek-worker -u jobseek-worker-2 --since "${since}" -o json --no-pager`,
    { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 },
  );
  const events: EventLog[] = [];

  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const envelope = safeJsonParse<EventEnvelope>(line);
    if (!envelope?.MESSAGE) continue;
    const payload = safeJsonParse<EventLog>(envelope.MESSAGE);
    if (!payload?.event) continue;
    events.push(payload);
  }
  return events;
}

function parseDbState(): { active: number; idle: number; idle_in_transaction: number } {
  const initial = { active: 0, idle: 0, idle_in_transaction: 0 };
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return initial;

  const query = "SELECT state, count(*) FROM pg_stat_activity GROUP BY state;";
  const run = (url: string): string =>
    execSync(`psql "${url}" -t -A -F '|' -c "${query}"`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 4 * 1024 * 1024,
    });

  let output = "";
  try {
    output = run(dbUrl);
  } catch {
    const base = dbUrl.split("?")[0] ?? dbUrl;
    output = run(`${base}?sslmode=require`);
  }

  for (const row of output.split("\n")) {
    if (!row.trim()) continue;
    const [stateRaw, countRaw] = row.split("|");
    const state = (stateRaw ?? "").trim().toLowerCase();
    const count = Number.parseInt((countRaw ?? "").trim(), 10);
    const safeCount = Number.isFinite(count) ? count : 0;

    if (state === "active") initial.active = safeCount;
    else if (state === "idle") initial.idle = safeCount;
    else if (state === "idle in transaction") initial.idle_in_transaction = safeCount;
  }
  return initial;
}

function buildRecommendation(anomalies: string[]): string {
  const recs: string[] = [];
  if (anomalies.includes("high_duplicate_load")) {
    recs.push("reduce ingest duplicates or adjust TTL");
  }
  if (anomalies.includes("parser_idle")) {
    recs.push("verify parse triggering path");
  }
  if (anomalies.includes("queue_backpressure")) {
    recs.push("increase worker concurrency OR reduce input rate");
  }
  if (anomalies.includes("cache_ineffective")) {
    recs.push("fix normalization or increase reuse");
  }
  if (recs.length === 0) {
    return "no immediate action required; continue monitoring";
  }
  return recs.join("; ");
}

function computeReport(events: EventLog[]): Report {
  const parseLatencies = events
    .filter((e) => e.event === "ai_parse_latency")
    .map((e) => Number(e.durationMs))
    .filter((n) => Number.isFinite(n) && n >= 0);

  const parseCacheEvents = events.filter((e) => e.event === "parse_cache");
  const parseCacheHits = parseCacheEvents.filter((e) => e.hit === true).length;

  const queueSnapshots = events.filter((e) => e.event === "worker_queue_snapshot");
  const jobsPerMinSamples = queueSnapshots
    .map((e) => Number(e.jobsPerMinApprox))
    .filter((n) => Number.isFinite(n) && n >= 0);
  const queueWaitSamples = queueSnapshots
    .map((e) => Number(e.wait))
    .filter((n) => Number.isFinite(n) && n >= 0);

  const duplicateCount = events.filter((e) => e.event === "job_duplicate_sourceUrl").length;
  const insertedCount = events.filter((e) => e.event === "job_inserted").length;
  const canonicalCreatedCount = events.filter((e) => e.event === "job_canonical_created").length;
  /** Matches `recentJobSeen.service` INFO `dedupe_decision` (avoid double-count with `job_skipped_recent_duplicate`). */
  const skippedRecentCount = events.filter(
    (e) => e.event === "dedupe_decision" && e.seen === true,
  ).length;

  const jobsPerMin = avg(jobsPerMinSamples);
  const parseCallsPerMin = parseLatencies.length / 10;
  const avgLatency = avg(parseLatencies);
  const p95Latency = percentile(parseLatencies, 95);
  const cacheHitRate =
    parseCacheEvents.length > 0 ? parseCacheHits / parseCacheEvents.length : 0;

  const duplicateDenom = duplicateCount + insertedCount + canonicalCreatedCount;
  const duplicateRatio = duplicateDenom > 0 ? duplicateCount / duplicateDenom : 0;

  const skipDenom = skippedRecentCount + insertedCount;
  const skipRate = skipDenom > 0 ? skippedRecentCount / skipDenom : 0;

  let queueTrend: QueueTrend = "stable";
  if (queueWaitSamples.length >= 2) {
    const first = queueWaitSamples[0] ?? 0;
    const last = queueWaitSamples[queueWaitSamples.length - 1] ?? 0;
    if (last > first) queueTrend = "increasing";
    else if (last < first) queueTrend = "decreasing";
  }

  const dbState = parseDbState();

  const anomalies: string[] = [];
  if (dbState.idle_in_transaction > 3) anomalies.push("db_transaction_leak");
  if (parseCallsPerMin === 0) anomalies.push("parser_idle");
  if (cacheHitRate < 0.1 && parseCallsPerMin > 0) anomalies.push("cache_ineffective");
  if (queueTrend === "increasing") anomalies.push("queue_backpressure");
  if (duplicateRatio > 0.9) anomalies.push("high_duplicate_load");

  let bottleneck = "none";
  if (anomalies.includes("queue_backpressure")) bottleneck = "queue";
  else if (anomalies.includes("parser_idle")) bottleneck = "ingest";
  else if (anomalies.includes("cache_ineffective")) bottleneck = "cache";

  let systemState: SystemState = "healthy";
  if (jobsPerMin === 0 && parseCallsPerMin === 0) {
    systemState = "idle";
  } else if (anomalies.length > 0) {
    systemState = "degraded";
  }

  return {
    jobs_per_min: round(jobsPerMin, 2),
    parse_calls_per_min: round(parseCallsPerMin, 2),
    avg_latency: round(avgLatency, 2),
    p95_latency: round(p95Latency, 2),
    cache_hit_rate: round(cacheHitRate, 4),
    duplicate_ratio: round(duplicateRatio, 4),
    skip_rate: round(skipRate, 4),
    queue_wait_trend: queueTrend,
    db_state: dbState,
    anomalies,
    bottleneck,
    system_state: systemState,
    recommendation: buildRecommendation(anomalies),
  };
}

function printReport(): void {
  const events = parseJournalEvents();
  const report = computeReport(events);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function main(): Promise<void> {
  loadRootEnv();
  const watch = process.argv.includes("--watch");
  if (!watch) {
    printReport();
    return;
  }
  printReport();
  setInterval(() => {
    try {
      printReport();
    } catch (err) {
      process.stderr.write(`monitor_pipeline_watch_error: ${String(err)}\n`);
    }
  }, 60_000);
}

void main().catch((err) => {
  process.stderr.write(`monitor_pipeline_failed: ${String(err)}\n`);
  process.exitCode = 1;
});
