import type { ProviderCapabilityMeta, ProviderId, ProviderRuntimeSnapshot } from "./provider.types.js";
import { loadOpenClawEnv } from "./providers/openclaw/openclaw.env.js";
import { getOpenClawStateSnapshot } from "./providers/openclaw/openclaw.state.js";
import { readOpenClawQuotaUsed } from "./providers/openclaw/openclaw.quota.js";
import { readOpenClawMetricsHash } from "./providers/openclaw/openclaw.analytics.js";
import { getIoredis } from "../../queues/job.queue.js";

export const OPENCLAW_CAPABILITIES: ProviderCapabilityMeta = {
  id: "openclaw",
  label: "Remote Rocketship (OpenClaw)",
  supportsJobIngestion: true,
  supportsCompanyDiscovery: true,
  supportsAtsHints: true,
  defaultRateLimitRequestsPerDay: 1000,
};

function redisOrNull(): ReturnType<typeof getIoredis> | null {
  try {
    return getIoredis();
  } catch {
    return null;
  }
}

export async function getProviderRuntimeSnapshot(id: ProviderId): Promise<ProviderRuntimeSnapshot | null> {
  if (id !== "openclaw") return null;
  const cfg = loadOpenClawEnv();
  const st = getOpenClawStateSnapshot();
  const redis = redisOrNull();
  const used = await readOpenClawQuotaUsed(redis);
  const limit = Math.max(0, cfg.maxRequestsPerDay - cfg.quotaReserve);
  const remaining = used === null ? null : Math.max(0, limit - used);

  const health = !cfg.enabled ? "disabled" : !cfg.apiKey?.trim() ? "disabled" : st.health;

  return {
    id: "openclaw",
    health,
    lastSuccessAt: st.lastSuccessAt,
    lastAttemptAt: st.lastAttemptAt,
    lastErrorKind: st.lastErrorKind,
    quotaRemainingEstimate: remaining,
    quotaUsedToday: used,
    circuitOpenUntil: st.circuit.openUntil,
    disabledReason: !cfg.enabled
      ? "OPENCLAW_ENABLED=false"
      : !cfg.apiKey?.trim()
        ? "missing_OPENCLAW_API_KEY"
        : st.disabledReason,
  };
}

export async function getOpenClawMetricsForInternalSnapshot(): Promise<{
  capabilities: ProviderCapabilityMeta;
  runtime: ProviderRuntimeSnapshot | null;
  metricsToday: Record<string, string>;
} | null> {
  const cfg = loadOpenClawEnv();
  if (!cfg.enabled) return null;
  const redis = redisOrNull();
  const [runtime, metricsToday] = await Promise.all([
    getProviderRuntimeSnapshot("openclaw"),
    readOpenClawMetricsHash(redis),
  ]);
  return {
    capabilities: OPENCLAW_CAPABILITIES,
    runtime,
    metricsToday: metricsToday as Record<string, string>,
  };
}
