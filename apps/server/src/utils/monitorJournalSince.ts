/**
 * Single default for `journalctl --since` in monitor:pipeline and runSmokeTest15m
 * (cumulative / monitor-aligned windows). Override to match e.g. a 15m smoke run.
 */
export const DEFAULT_MONITOR_PIPELINE_JOURNAL_SINCE = "10 min ago";

export function getMonitorPipelineJournalSince(): string {
  const raw = process.env.MONITOR_PIPELINE_JOURNAL_SINCE;
  if (raw !== undefined && raw.trim() !== "") return raw.trim();
  return DEFAULT_MONITOR_PIPELINE_JOURNAL_SINCE;
}

/** runSmokeTest15m per-tick jctl sample window (denser than cumulative). */
export const DEFAULT_SMOKE_TICK_JOURNAL_SINCE = "5 min ago";

export function getSmokeTickJournalSince(): string {
  const raw = process.env.SMOKE_JOURNAL_TICK_SINCE;
  if (raw !== undefined && raw.trim() !== "") return raw.trim();
  return DEFAULT_SMOKE_TICK_JOURNAL_SINCE;
}
