/**
 * Read-only ingestion rollout validation (HTTP GET only).
 *
 * Usage:
 *   cd apps/server && npx tsx scripts/ingestion/validateRollout.ts
 *   npx tsx scripts/ingestion/validateRollout.ts --baseline /tmp/ingestion-baseline-before.json
 *
 * Env:
 *   INGESTION_HEALTH_URL — full URL (default: API_BASE_URL or http://127.0.0.1:3001 + /internal/ingestion/health)
 *   INTERNAL_METRICS_TOKEN — Bearer token when production auth is enabled
 */
import { readFileSync } from "node:fs";
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import type { IngestionObservabilitySnapshot } from "../../src/services/ingestionObservability.service.js";

loadRootEnv();

type Severity = "PASS" | "WARN" | "FAIL";

type Check = { id: string; severity: Severity; detail: string };

function parseBaselinePath(argv: string[]): string | null {
  const i = argv.indexOf("--baseline");
  if (i < 0) return null;
  return argv[i + 1]?.trim() || null;
}

function loadBaselineSnapshot(path: string): IngestionObservabilitySnapshot | null {
  try {
    const raw = readFileSync(path, "utf8");
    const j = JSON.parse(raw) as { snapshot?: IngestionObservabilitySnapshot };
    return j.snapshot ?? (j as unknown as IngestionObservabilitySnapshot);
  } catch {
    return null;
  }
}

function ingestUrl(): string {
  const explicit = process.env.INGESTION_HEALTH_URL?.trim();
  if (explicit) return explicit;
  const base = (
    process.env.API_BASE_URL ??
    process.env.PUBLIC_API_URL ??
    "http://127.0.0.1:3001"
  ).replace(/\/$/, "");
  return `${base}/internal/ingestion/health`;
}

function queueRow(snap: IngestionObservabilitySnapshot, name: string) {
  return snap.queues.find((q) => q.name === name);
}

function runChecks(
  snap: IngestionObservabilitySnapshot,
  baseline: IngestionObservabilitySnapshot | null,
): Check[] {
  const checks: Check[] = [];
  const ats = queueRow(snap, "ingest-ats-endpoint");
  const jobQ = queueRow(snap, "job-processing");

  if (!ats || ats.waiting < 0) {
    checks.push({
      id: "ats_queue_probe",
      severity: "FAIL",
      detail: "ingest-ats-endpoint queue metrics missing or probe failed (see snapshot.notes).",
    });
  } else {
    if (ats.waiting > 120) {
      checks.push({
        id: "ats_waiting_depth",
        severity: "FAIL",
        detail: `ingest-ats-endpoint waiting=${ats.waiting} (threshold 120).`,
      });
    } else if (ats.waiting > 80) {
      checks.push({
        id: "ats_waiting_depth",
        severity: "WARN",
        detail: `ingest-ats-endpoint waiting=${ats.waiting} (warn > 80).`,
      });
    } else {
      checks.push({
        id: "ats_waiting_depth",
        severity: "PASS",
        detail: `ingest-ats-endpoint waiting=${ats.waiting}.`,
      });
    }

    const oldest = ats.oldestWaitingMs;
    const fortyFiveMin = 45 * 60 * 1000;
    if (oldest != null && oldest > fortyFiveMin) {
      checks.push({
        id: "ats_oldest_waiting",
        severity: "FAIL",
        detail: `oldestWaitingMs=${oldest} on ingest-ats-endpoint (> 45m).`,
      });
    } else if (oldest != null && oldest > 15 * 60 * 1000) {
      checks.push({
        id: "ats_oldest_waiting",
        severity: "WARN",
        detail: `oldestWaitingMs=${oldest} on ingest-ats-endpoint (> 15m).`,
      });
    } else {
      checks.push({
        id: "ats_oldest_waiting",
        severity: "PASS",
        detail: `oldestWaitingMs=${oldest ?? "null"} on ingest-ats-endpoint.`,
      });
    }
  }

  const hb = snap.serpSchedulerHeartbeat;
  const fourHours = 4 * 60 * 60 * 1000;
  if (hb.ageMs != null && hb.ageMs > fourHours) {
    checks.push({
      id: "serp_heartbeat_age",
      severity: "WARN",
      detail: `SERP heartbeat ageMs=${hb.ageMs} (~${Math.round(hb.ageMs / 3600000)}h); verify daemon/cron.`,
    });
  } else {
    checks.push({
      id: "serp_heartbeat_age",
      severity: "PASS",
      detail: `SERP heartbeat ageMs=${hb.ageMs ?? "null"} key=${hb.key}.`,
    });
  }

  const pj = snap.primaryJobs;
  if (pj) {
    if (pj.processing_parse_present > 200) {
      checks.push({
        id: "primary_parse_processing",
        severity: "WARN",
        detail: `processing_parse_present=${pj.processing_parse_present} (reconcile backlog signal).`,
      });
    } else {
      checks.push({
        id: "primary_parse_processing",
        severity: "PASS",
        detail: `processing_parse_present=${pj.processing_parse_present}.`,
      });
    }
    if (pj.processing_primaries > 8000) {
      checks.push({
        id: "primary_processing_total",
        severity: "WARN",
        detail: `processing_primaries=${pj.processing_primaries} (very high).`,
      });
    } else {
      checks.push({
        id: "primary_processing_total",
        severity: "PASS",
        detail: `processing_primaries=${pj.processing_primaries}.`,
      });
    }
  }

  if (jobQ && jobQ.failed > 500) {
    checks.push({
      id: "job_queue_failed_spike",
      severity: "WARN",
      detail: `job-processing failed=${jobQ.failed} (> 500).`,
    });
  } else if (jobQ) {
    checks.push({
      id: "job_queue_failed_spike",
      severity: "PASS",
      detail: `job-processing failed=${jobQ.failed}.`,
    });
  }

  const drift = snap.endpointFreshnessDrift;
  if (drift && drift.olderThan24h > 0) {
    checks.push({
      id: "endpoint_drift_24h",
      severity: "PASS",
      detail: `endpoints olderThan24h gate=${drift.olderThan24h} (includes never-crawled null stamps).`,
    });
  }

  if (baseline) {
    const bAts = queueRow(baseline, "ingest-ats-endpoint");
    if (ats && bAts && bAts.waiting > 0) {
      const ratio = ats.waiting / bAts.waiting;
      if (ratio >= 1.5 && ats.waiting - bAts.waiting > 20) {
        checks.push({
          id: "ats_waiting_vs_baseline",
          severity: "WARN",
          detail: `ATS waiting grew vs baseline (${bAts.waiting} -> ${ats.waiting}).`,
        });
      }
    }
  }

  return checks;
}

function rollup(checks: Check[]): Severity {
  if (checks.some((c) => c.severity === "FAIL")) return "FAIL";
  if (checks.some((c) => c.severity === "WARN")) return "WARN";
  return "PASS";
}

void (async () => {
  const argv = process.argv.slice(2);
  const baselinePath = parseBaselinePath(argv);
  const baseline = baselinePath ? loadBaselineSnapshot(baselinePath) : null;
  if (baselinePath && !baseline) {
    console.error(`Could not read baseline: ${baselinePath}`);
    process.exitCode = 1;
    return;
  }

  const url = ingestUrl();
  const headers: Record<string, string> = {};
  const token = process.env.INTERNAL_METRICS_TOKEN?.trim();
  if (token) headers.authorization = `Bearer ${token}`;

  let res: Response;
  let text: string;
  try {
    res = await fetch(url, { headers });
    text = await res.text();
  } catch (err) {
    console.log(
      JSON.stringify(
        {
          status: "FAIL",
          url,
          detail: err instanceof Error ? err.message : String(err),
          hint: "Start the API or set INGESTION_HEALTH_URL to a reachable host.",
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }
  if (!res.ok) {
    console.log(
      JSON.stringify(
        {
          status: "FAIL",
          httpStatus: res.status,
          url,
          detail: text.slice(0, 500),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }

  let snap: IngestionObservabilitySnapshot;
  try {
    snap = JSON.parse(text) as IngestionObservabilitySnapshot;
  } catch {
    console.log(JSON.stringify({ status: "FAIL", detail: "Invalid JSON from health endpoint" }, null, 2));
    process.exitCode = 1;
    return;
  }

  const checks = runChecks(snap, baseline);
  const status = rollup(checks);
  const out = {
    status,
    url,
    generatedAt: snap.generatedAt,
    checks,
    hints: snap.notes ?? [],
    baselineUsed: baselinePath,
  };
  console.log(JSON.stringify(out, null, 2));
  if (status === "FAIL") process.exitCode = 1;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
