import fs from "node:fs";
import path from "node:path";
import { createStream, type RotatingFileStream } from "rotating-file-stream";
import pino from "pino";
import build from "pino-pretty";

const isDev = process.env.NODE_ENV !== "production";

/** Base directory for rotated logs (default: `<cwd>/logs`). */
export const LOG_DIR = process.env.LOG_DIR
  ? path.resolve(process.env.LOG_DIR)
  : path.join(process.cwd(), "logs");

/** How many daily files to keep (rotating-file-stream) + purge threshold in days. */
const RETENTION_DAYS = Math.max(
  1,
  parseInt(process.env.LOG_RETENTION_DAYS ?? "3", 10) || 3,
);

const LOG_TO_FILE = process.env.LOG_TO_FILE !== "false";

function toDateStamp(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function detectProcessRole(): string {
  const script = (process.argv[1] || "").toLowerCase().replace(/\\/g, "/");
  if (script.endsWith("/src/index.ts") || script.endsWith("/dist/index.js")) return "server";
  if (script.includes("/workers/job.processor.")) return "worker-job";
  if (script.includes("/workers/enrich-company.processor.")) return "worker-enrich";
  if (script.includes("/workers/discovery.processor.")) return "worker-discovery";
  if (script.includes("/modules/crawler/crawler.scheduler.")) return "scheduler-crawler";
  if (script.includes("/modules/discovery/discovery.scheduler.")) return "scheduler-discovery";
  if (script.includes("/scripts/seed.companies.")) return "seed";
  if (script.includes("/scripts/seedcompaniesfromcsv.")) return "seed-csv";
  if (script.includes("/scripts/metrics.snapshot.")) return "metrics";
  return process.env.LOG_ROLE?.trim() || "process";
}

/**
 * Active log file name defaults to `jobseek-<role>-<yyyymmdd>.log`.
 * This makes files readable by process role while avoiding one shared file for all processes.
 * Override with `LOG_FILE_NAME` for custom naming.
 */
const ACTIVE_LOG_BASENAME =
  process.env.LOG_FILE_NAME?.trim() ||
  `jobseek-${detectProcessRole()}-${toDateStamp(new Date())}.log`;

/**
 * Persistent rotation ledger for `maxFiles`. Scoped per active basename so multiple
 * processes (server, workers, schedulers) do not corrupt a single shared history file.
 */
const RFS_HISTORY_PATH = path.join(
  LOG_DIR,
  `.rfs-history-${path.basename(ACTIVE_LOG_BASENAME, ".log")}`,
);

fs.mkdirSync(LOG_DIR, { recursive: true });

type PurgeStats = { scanned: number; deleted: number; skipped: number; errors: number };

/**
 * Remove `.log` files in LOG_DIR older than retention (mtime). Does not rely on filename shape.
 * Never deletes the current process active file, dotfiles, or directories.
 */
function purgeStaleLogFiles(): PurgeStats {
  const maxAgeMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const stats: PurgeStats = { scanned: 0, deleted: 0, skipped: 0, errors: 0 };
  let names: string[];
  try {
    names = fs.readdirSync(LOG_DIR);
  } catch {
    console.error("[logger] purge: failed to read LOG_DIR");
    stats.errors++;
    return stats;
  }

  for (const name of names) {
    if (name.startsWith(".")) {
      stats.skipped++;
      continue;
    }
    if (!name.endsWith(".log")) {
      stats.skipped++;
      continue;
    }
    if (name === ACTIVE_LOG_BASENAME) {
      stats.skipped++;
      continue;
    }

    const fp = path.join(LOG_DIR, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(fp);
    } catch {
      stats.errors++;
      continue;
    }
    if (!st.isFile()) {
      stats.skipped++;
      continue;
    }

    stats.scanned++;
    if (now - st.mtimeMs <= maxAgeMs) {
      stats.skipped++;
      continue;
    }

    try {
      fs.unlinkSync(fp);
      stats.deleted++;
    } catch {
      stats.errors++;
    }
  }

  console.log(
    `[logger] purge: scanned=${stats.scanned} deleted=${stats.deleted} skipped=${stats.skipped} errors=${stats.errors}`,
  );
  return stats;
}

function emitStartupDiagnostics(): void {
  const role = detectProcessRole();
  const historyExists = fs.existsSync(RFS_HISTORY_PATH);
  if (!LOG_TO_FILE) {
    console.log(
      `[logger] init: role=${role} activeLog=${ACTIVE_LOG_BASENAME} retentionDays=${RETENTION_DAYS} logToFile=false rfsHistoryPath=${RFS_HISTORY_PATH} rfsHistoryExists=${historyExists}`,
    );
    return;
  }
  console.log(
    `[logger] init: role=${role} activeLog=${ACTIVE_LOG_BASENAME} retentionDays=${RETENTION_DAYS} logToFile=true rfsHistoryPath=${RFS_HISTORY_PATH} rfsHistoryExists=${historyExists}`,
  );
}

purgeStaleLogFiles();
const purgeIntervalMs = 24 * 60 * 60 * 1000;
const purgeTimer = setInterval(purgeStaleLogFiles, purgeIntervalMs);
if (typeof purgeTimer.unref === "function") {
  purgeTimer.unref();
}

emitStartupDiagnostics();

const level = process.env.LOG_LEVEL ?? (isDev ? "debug" : "info");

function attachRotatingStreamGuards(stream: RotatingFileStream): void {
  stream.on("error", (err: NodeJS.ErrnoException) => {
    const msg = err?.message ?? String(err);
    // stderr fallback: file stream may fail before pino can reliably log.
    console.error(
      `[logger] file stream error (${ACTIVE_LOG_BASENAME}): ${msg}`,
      err?.code ?? "",
    );
    if (err?.code === "ENOENT" || err?.code === "EPERM") {
      console.error(
        "[logger] Hint: use role-based logs (default jobseek-<role>-<yyyymmdd>.log) or LOG_TO_FILE=false; avoid multiple processes sharing LOG_FILE_NAME.",
      );
    }
  });
}

function buildLogger(): pino.Logger {
  if (!LOG_TO_FILE) {
    if (isDev) {
      return pino(
        { level },
        build({
          colorize: true,
          translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
        }),
      );
    }
    return pino({ level });
  }

  const fileStream = createStream(ACTIVE_LOG_BASENAME, {
    interval: "1d",
    path: LOG_DIR,
    maxFiles: RETENTION_DAYS,
    history: RFS_HISTORY_PATH,
  });
  attachRotatingStreamGuards(fileStream);

  if (isDev) {
    const prettyStream = build({
      colorize: true,
      translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
    });
    return pino(
      { level },
      pino.multistream([
        { level: "trace" as const, stream: prettyStream },
        { level: "trace" as const, stream: fileStream },
      ]),
    );
  }

  return pino(
    { level },
    pino.multistream([
      { level: "trace" as const, stream: process.stdout },
      { level: "trace" as const, stream: fileStream },
    ]),
  );
}

export const logger = buildLogger();
