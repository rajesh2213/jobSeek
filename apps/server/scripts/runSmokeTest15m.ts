/**
 * 15×60s smoke test: journal samples + Prisma + monitor:pipeline, then final report JSON.
 * Also samples discovery + ATS discovery units (if installed): jobseek-discovery-worker,
 * jobseek-discovery-scheduler, jobseek-ats-discovery-worker, jobseek-ats-discovery-scheduler.
 *
 * Run from monorepo root:
 *   cd jobSeek && env -u NODE_ENV CSV_SEED_LOG_PATH=/tmp/csv_seed_500.log npx tsx apps/server/scripts/runSmokeTest15m.ts
 *
 * Note: csv_seed_summary appears in seed:csv stdout, not in jobseek-api/worker journal.
 * Env: SMOKE_TEST_TICKS (default 15), SMOKE_TEST_INTERVAL_SEC (default 60). For 10×1m: SMOKE_TEST_TICKS=10
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import { loadRootEnv } from "../src/infrastructure/env/loadEnv.js";
import { prisma } from "../src/infrastructure/db/prisma.js";
import {
  getMonitorPipelineJournalSince,
  getSmokeTickJournalSince,
} from "../src/utils/monitorJournalSince.js";

function readPositiveIntEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return defaultValue;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

const TICKS = readPositiveIntEnv("SMOKE_TEST_TICKS", 15);
const INTERVAL_MS = readPositiveIntEnv("SMOKE_TEST_INTERVAL_SEC", 60) * 1000;

/** Weighted avg: stricter than 0.1 so “dedupe_working” reflects real skip/duplicate signal, not noise. */
const DEDUPE_SIGNAL_THRESHOLD = 0.3;

const JOBSEEK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const APPS_SERVER = path.join(JOBSEEK_ROOT, "apps/server");

function jctl(units: string[], since: string): string {
  const u = units.map((x) => `-u ${x}`).join(" ");
  return execSync(`journalctl ${u} --since "${since}" --no-pager 2>/dev/null`, {
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function countSubstr(s: string, needle: string): number {
  let n = 0;
  for (const line of s.split("\n")) {
    if (line.includes(needle)) n += 1;
  }
  return n;
}

/** One `monitor:pipeline` JSON snapshot; collected each tick to aggregate over the full run. */
type MonitorSnapshot = {
  skip_rate?: number;
  duplicate_ratio?: number;
  system_state?: string;
  jobs_per_min?: number;
  parse_calls_per_min?: number;
  cache_hit_rate?: number;
};

type TickSample = {
  tick: number;
  at: string;
  enrich_domain_resolved_5m: number;
  enrich_domain_missing_5m: number;
  worker_ai_parse_5m: number;
  worker_parse_cache_5m: number;
  worker_queue_wait_samples: number[] | null;
  scheduler_priority_dist_5m: number;
  /** Discovery worker: company source lines in tick window. */
  discovery_companies_found_5m: number;
  /** Discovery scheduler: run summary / start lines in tick window. */
  discovery_summary_5m: number;
  /** ATS discovery worker: endpoint discovery attempts in tick window. */
  ats_discovery_attempt_5m: number;
  /** ATS discovery scheduler: enqueue / start lines in tick window. */
  ats_discovery_scheduler_signal_5m: number;
  /** Pipeline monitor snapshot for this tick (entire-run health uses aggregates of these). */
  monitor: MonitorSnapshot | null;
};

function collectTick(tick: number): TickSample {
  const tickSince = getSmokeTickJournalSince();
  const monitorSince = getMonitorPipelineJournalSince();
  const w5 = jctl(["jobseek-worker", "jobseek-worker-2"], tickSince);
  const e5 = jctl(["jobseek-enrich"], tickSince);
  const s5 = jctl(["jobseek-scheduler"], tickSince);
  const dW = jctl(["jobseek-discovery-worker"], tickSince);
  const dS = jctl(["jobseek-discovery-scheduler"], tickSince);
  const aW = jctl(["jobseek-ats-discovery-worker"], tickSince);
  const aS = jctl(["jobseek-ats-discovery-scheduler"], tickSince);

  let waitSamples: number[] | null = null;
  try {
    const jq = execSync(
      `journalctl -u jobseek-worker -u jobseek-worker-2 -o json --since "${monitorSince}" --no-pager 2>/dev/null | jq -r '(.MESSAGE | fromjson? // empty) | select(.event=="worker_queue_snapshot") | .wait' 2>/dev/null || true`,
      { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024, shell: "/bin/bash" },
    );
    const parts = jq
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    waitSamples = parts.length > 0 ? parts : null;
  } catch {
    waitSamples = null;
  }

  const monRawTick = runMonitorPipeline();
  const monParsedTick = parseMonitorJson(monRawTick);

  return {
    tick,
    at: new Date().toISOString(),
    enrich_domain_resolved_5m: countSubstr(e5, "domain_resolved"),
    enrich_domain_missing_5m: countSubstr(e5, "domain_missing"),
    worker_ai_parse_5m: countSubstr(w5, "ai_parse_latency"),
    worker_parse_cache_5m: countSubstr(w5, "parse_cache"),
    worker_queue_wait_samples: waitSamples,
    scheduler_priority_dist_5m: countSubstr(s5, "company_priority_distribution"),
    discovery_companies_found_5m: countSubstr(dW, "companies_found"),
    discovery_summary_5m: countSubstr(dS, "discovery_summary") + countSubstr(dS, "discovery_start"),
    ats_discovery_attempt_5m: countSubstr(aW, "ats_endpoint_discovery_attempt"),
    ats_discovery_scheduler_signal_5m:
      countSubstr(aS, "ats_discovery_scheduler_enqueued") + countSubstr(aS, "ats_discovery_scheduler_started"),
    monitor: monParsedTick,
  };
}

function runMonitorPipeline(): string {
  const opts = {
    encoding: "utf-8" as const,
    maxBuffer: 4 * 1024 * 1024,
    env: process.env,
  };

  // Prefer direct `tsx` (no npm parent); avoids exit-code quirks and captures stderr on failure.
  const direct = spawnSync("npx", ["tsx", "src/scripts/monitorPipeline.ts"], {
    ...opts,
    cwd: APPS_SERVER,
  });
  const directOut = `${direct.stdout ?? ""}${direct.stderr ?? ""}`.trim();
  if (direct.status === 0 && directOut !== "") {
    return directOut;
  }

  const viaNpm = spawnSync("npm", ["run", "monitor:pipeline", "-w", "@jobseek/server"], {
    ...opts,
    cwd: JOBSEEK_ROOT,
  });
  const npmOut = `${viaNpm.stdout ?? ""}${viaNpm.stderr ?? ""}`.trim();
  if (viaNpm.status === 0 && npmOut !== "") {
    return npmOut;
  }

  return [
    "monitor_pipeline_invoke_error",
    `direct_tsx: exit=${direct.status} stderr_head=${(direct.stderr ?? "").slice(0, 2000)}`,
    `via_npm: exit=${viaNpm.status} stderr_head=${(viaNpm.stderr ?? "").slice(0, 2000)}`,
    `direct_stdout_head=${(direct.stdout ?? "").slice(0, 2000)}`,
    `npm_combined_head=${npmOut.slice(0, 2000)}`,
  ].join("\n");
}

type SeedLogMetrics = {
  totalRows?: number;
  invalidCount?: number;
  inserted?: number;
  fallbackInserted?: number;
} | null;

function parseLastSeedLog(): SeedLogMetrics {
  const p = process.env.CSV_SEED_LOG_PATH;
  if (!p || !existsSync(p)) return null;
  const raw = readFileSync(p, "utf-8");
  for (const line of raw.trim().split("\n").reverse()) {
    if (!line.includes("csv_seed_summary")) continue;
    try {
      const o = JSON.parse(line) as Record<string, unknown>;
      if (o.event === "csv_seed_summary")
        return {
          totalRows: o.totalRows as number | undefined,
          invalidCount: o.invalidCount as number | undefined,
          inserted: o.inserted as number | undefined,
          fallbackInserted: o.fallbackInserted as number | undefined,
        };
    } catch {
      /* line may not be pure JSON */
    }
  }
  return null;
}

async function dbSnapshot() {
  const csvSeed = await prisma.company.count({ where: { discoverySource: "csv_seed" } });
  const csvFb = await prisma.company.count({ where: { discoverySource: "csv_seed_fallback" } });
  const fbRows = await prisma.company.findMany({
    where: { discoverySource: "csv_seed_fallback" },
    select: { domain: true },
  });
  const resolved = fbRows.filter((r) => r.domain != null && String(r.domain).trim() !== "").length;
  const unresolved = fbRows.length - resolved;
  const byPri = await prisma.$queryRaw<{ priority: string; c: bigint }[]>`
    SELECT "priority"::text AS priority, COUNT(*)::bigint AS c
    FROM "Company"
    GROUP BY "priority"
  `;
  const pr = Object.fromEntries(
    byPri.map((r) => [r.priority, Number(r.c)]),
  ) as Record<string, number>;
  const top = await prisma.$queryRaw<{ name: string; jobs: bigint }[]>`
    SELECT c.name, COUNT(j.id)::bigint AS jobs
    FROM "Job" j
    JOIN "Company" c ON j."companyId" = c.id
    WHERE j."canonicalJobId" IS NULL
    GROUP BY c.id, c.name
    ORDER BY jobs DESC
    LIMIT 10`;
  return {
    discoverySource: { csv_seed: csvSeed, csv_seed_fallback: csvFb },
    fallback_domain: {
      resolved,
      unresolved,
      ratio: csvFb ? resolved / csvFb : 0,
    },
    priority: pr,
    top_companies: top.map((r) => ({ name: r.name, jobs: Number(r.jobs) })),
  };
}

function parseMonitorJson(raw: string): MonitorSnapshot | null {
  const startPretty = raw.indexOf('{\n  "jobs_per_min"');
  const startOneLine = raw.indexOf('{"jobs_per_min"');
  const start =
    startPretty >= 0 ? startPretty : startOneLine >= 0 ? startOneLine : -1;
  if (start >= 0) {
    let depth = 0;
    let end = -1;
    for (let i = start; i < raw.length; i += 1) {
      const c = raw[i]!;
      if (c === "{") depth += 1;
      else if (c === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end > start) {
      try {
        return JSON.parse(raw.slice(start, end)) as MonitorSnapshot;
      } catch {
        /* fall through */
      }
    }
  }
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as MonitorSnapshot;
  } catch {
    return null;
  }
}

/**
 * Activity-weighted duplicate/skip rates:
 * - Weight = max(parse_calls_per_min, jobs_per_min) so enqueue/crawl throughput is not
 *   under-represented when dedupe runs pre-parse but parse volume is low.
 * - Idle ticks (weight 0) do not dilute busy periods.
 */
function aggregateMonitorAcrossTicks(ticks: TickSample[]): {
  maxParseCalls: number;
  totalParseCalls: number;
  maxJobsPerMin: number;
  avgSkipRate: number;
  avgDuplicateRatio: number;
  parseActivityWeight: number;
  activeTicks: number;
  activeRatio: number;
  anyCacheHit: boolean;
  tickCount: number;
} {
  let maxParseCalls = 0;
  let totalParseCalls = 0;
  let maxJobsPerMin = 0;
  const tickCount = ticks.length;
  let anyCacheHit = false;
  let activeTicks = 0;

  let weightedDuplicate = 0;
  let weightedSkip = 0;
  let totalWeight = 0;

  for (const t of ticks) {
    const m = t.monitor;
    const weight = Math.max(
      t.monitor?.parse_calls_per_min || 0,
      t.monitor?.jobs_per_min || 0,
    );
    const pc = m?.parse_calls_per_min ?? 0;
    const jm = m?.jobs_per_min ?? 0;
    const sr = m?.skip_rate ?? 0;
    const dr = m?.duplicate_ratio ?? 0;
    const ch = m?.cache_hit_rate ?? 0;
    weightedDuplicate += dr * weight;
    weightedSkip += sr * weight;
    totalWeight += weight;

    maxParseCalls = Math.max(maxParseCalls, pc);
    totalParseCalls += pc;
    maxJobsPerMin = Math.max(maxJobsPerMin, jm);
    if (pc > 0) activeTicks += 1;
    if (ch > 0) anyCacheHit = true;
  }

  const avgSkipRate = totalWeight > 0 ? weightedSkip / totalWeight : 0;
  const avgDuplicateRatio = totalWeight > 0 ? weightedDuplicate / totalWeight : 0;
  const activeRatio = tickCount > 0 ? activeTicks / tickCount : 0;

  return {
    maxParseCalls,
    totalParseCalls,
    maxJobsPerMin,
    avgSkipRate,
    avgDuplicateRatio,
    parseActivityWeight: totalWeight,
    activeTicks,
    activeRatio,
    anyCacheHit,
    tickCount,
  };
}

function systemStateFromAggregates(
  maxParseCalls: number,
  avgDuplicateRatio: number,
): "healthy" | "degraded" | "idle" {
  if (maxParseCalls > 20 && avgDuplicateRatio > DEDUPE_SIGNAL_THRESHOLD) return "healthy";
  if (maxParseCalls > 0) return "degraded";
  return "idle";
}

async function main(): Promise<void> {
  process.chdir(JOBSEEK_ROOT);
  loadRootEnv();

  const seedLog = parseLastSeedLog();
  const ticks: TickSample[] = [];

  console.error(
    `runSmokeTest15m: ${TICKS} ticks × ${INTERVAL_MS / 1000}s, root=${JOBSEEK_ROOT} CSV_SEED_LOG_PATH=${process.env.CSV_SEED_LOG_PATH ?? ""}\n`,
  );

  for (let i = 1; i <= TICKS; i += 1) {
    if (i > 1) await setTimeout(INTERVAL_MS);
    ticks.push(collectTick(i));
    console.error(`[tick ${i}/${TICKS}] ${ticks[ticks.length - 1]!.at}`);
  }

  const cumulativeSince = getMonitorPipelineJournalSince();
  const tickSince = getSmokeTickJournalSince();
  const en15 = jctl(["jobseek-enrich"], cumulativeSince);
  const w15 = jctl(["jobseek-worker", "jobseek-worker-2"], cumulativeSince);
  const api5 = jctl(["jobseek-api", "jobseek-worker"], tickSince);
  const dw15 = jctl(["jobseek-discovery-worker"], cumulativeSince);
  const ds15 = jctl(["jobseek-discovery-scheduler"], cumulativeSince);
  const atsW15 = jctl(["jobseek-ats-discovery-worker"], cumulativeSince);
  const atsS15 = jctl(["jobseek-ats-discovery-scheduler"], cumulativeSince);

  const journal_cumulative_15m = {
    domain_resolved: countSubstr(en15, "domain_resolved"),
    domain_missing: countSubstr(en15, "domain_missing"),
    ai_parse_latency: countSubstr(w15, "ai_parse_latency"),
    parse_cache_lines: countSubstr(w15, "parse_cache"),
    parse_cache_hit_true: w15.includes('"hit":true'),
    parse_cache_hit_false: w15.includes('"hit":false'),
    discovery: {
      worker_companies_found: countSubstr(dw15, "companies_found"),
      worker_source_fetch_complete: countSubstr(dw15, "source_fetch_complete"),
      scheduler_discovery_summary: countSubstr(ds15, "discovery_summary"),
      scheduler_discovery_start: countSubstr(ds15, "discovery_start"),
    },
    ats_discovery: {
      worker_attempts: countSubstr(atsW15, "ats_endpoint_discovery_attempt"),
      worker_boot: countSubstr(atsW15, "ats_discovery_worker_started"),
      scheduler_enqueued: countSubstr(atsS15, "ats_discovery_scheduler_enqueued"),
      scheduler_boot: countSubstr(atsS15, "ats_discovery_scheduler_started"),
    },
  };

  /** Final snapshot for debug only; health uses aggregates over all ticks (see aggregated_metrics). */
  const monRaw = runMonitorPipeline();
  const monParsed = parseMonitorJson(monRaw);

  const db = await dbSnapshot();

  const csvInJournal = countSubstr(api5, "csv_seed_summary");

  const priorityNotAllLow = (db.priority.high ?? 0) + (db.priority.medium ?? 0) > 0;
  const domRatioOk =
    db.discoverySource.csv_seed_fallback === 0 || db.fallback_domain.ratio >= 0.4;
  const domResolvedOk =
    journal_cumulative_15m.domain_resolved >= journal_cumulative_15m.domain_missing;

  const agg = aggregateMonitorAcrossTicks(ticks);
  const avgSkipRate = agg.avgSkipRate;
  const avgDuplicateRatio = agg.avgDuplicateRatio;

  const dedupeOk =
    avgDuplicateRatio > DEDUPE_SIGNAL_THRESHOLD || avgSkipRate > DEDUPE_SIGNAL_THRESHOLD;

  const parserActive = agg.maxParseCalls > 10 || agg.totalParseCalls > 50;

  const cacheOk = agg.anyCacheHit;
  const schedulerActive = ticks.some((t) => t.scheduler_priority_dist_5m > 0);

  const lastWaits = ticks
    .map((t) => t.worker_queue_wait_samples?.[t.worker_queue_wait_samples.length - 1])
    .filter((n): n is number => typeof n === "number");
  const queueHealthy =
    lastWaits.length < 2 ? true : lastWaits[lastWaits.length - 1]! <= (lastWaits[0] ?? 0) * 1.5;

  const d = journal_cumulative_15m.discovery;
  const a = journal_cumulative_15m.ats_discovery;
  const discoveryWorkerSignaled =
    d.worker_companies_found > 0 || d.worker_source_fetch_complete > 0;
  const discoverySchedulerSignaled = d.scheduler_discovery_summary > 0 || d.scheduler_discovery_start > 0;
  const atsDiscoveryWorkerSignaled = a.worker_attempts > 0 || a.worker_boot > 0;
  const atsDiscoverySchedulerSignaled = a.scheduler_enqueued > 0 || a.scheduler_boot > 0;

  const sys = systemStateFromAggregates(agg.maxParseCalls, agg.avgDuplicateRatio);
  const cleanerFromLog = (seedLog?.invalidCount ?? 0) > 0;
  const final_smoke_test_json: Record<string, boolean | string> = {
    cleaner_working: cleanerFromLog,
    fallback_working: db.discoverySource.csv_seed_fallback > 0,
    domain_recovery_working: domResolvedOk && domRatioOk,
    dedupe_working: dedupeOk,
    parser_active: parserActive,
    cache_working: cacheOk,
    queue_healthy: queueHealthy,
    scoring_active: priorityNotAllLow,
    scheduler_active: schedulerActive,
    output_generation: db.top_companies.length > 0,
    system_state: sys,
    // true when journald shows discovery activity in MONITOR_PIPELINE_JOURNAL_SINCE (false if units missing / idle)
    discovery_worker_signaled: discoveryWorkerSignaled,
    discovery_scheduler_signaled: discoverySchedulerSignaled,
    ats_discovery_worker_signaled: atsDiscoveryWorkerSignaled,
    ats_discovery_scheduler_signaled: atsDiscoverySchedulerSignaled,
  };

  const report = {
    journal_since: {
      monitorPipeline: cumulativeSince,
      smokeTick: tickSince,
    },
    note:
      "csv_seed_summary is logged by the seed:csv process (stdout), not systemd. Set CSV_SEED_LOG_PATH. journal grep csv_seed_summary on api+worker: count in last tick window = " +
      String(csvInJournal),
    seed_log: seedLog,
    journal_csv_seed_grep_5m_api_worker: csvInJournal,
    db,
    ticks,
    journal_cumulative_15m,
    monitor_pipeline: { raw: monRaw.slice(0, 3000), parsed: monParsed },
    aggregated_metrics: {
      max_parse_calls: agg.maxParseCalls,
      total_parse_calls: agg.totalParseCalls,
      max_jobs_per_min: agg.maxJobsPerMin,
      avg_skip_rate: avgSkipRate,
      avg_duplicate_ratio: avgDuplicateRatio,
      /**
       * Sum of per-tick max(parse_calls_per_min, jobs_per_min) — relative “effort” for weighting,
       * not literal job counts (rates × tick cadence). Use active_ticks / active_ratio for load shape.
       */
      parse_activity_weight: agg.parseActivityWeight,
      active_ticks: agg.activeTicks,
      active_ratio: agg.activeRatio,
      dedupe_signal_threshold: DEDUPE_SIGNAL_THRESHOLD,
      any_cache_hit: agg.anyCacheHit,
    },
    final_smoke_test_json,
  };

  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();
}

void main().catch((e) => {
  console.error("runSmokeTest15m failed", e);
  process.exit(1);
});
