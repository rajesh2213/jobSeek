export interface OpenClawEnvConfig {
  enabled: boolean;
  apiKey: string | null;
  baseUrl: string;
  apiPath: string;
  timeoutMs: number;
  maxRequestsPerDay: number;
  quotaReserve: number;
  syncEnabled: boolean;
  discoveryEnabled: boolean;
  enrichmentEnabled: boolean;
  dryRun: boolean;
  cacheTtlSec: number;
  syncIntervalMs: number;
  itemsPerPage: number;
  maxPagesPerRun: number;
  circuitFailureThreshold: number;
  circuitCooldownMs: number;
  maxHttpRetries: number;
}

function parseBool(raw: string | undefined, defaultFalse: boolean): boolean {
  if (raw === undefined || raw === "") return defaultFalse;
  const t = raw.trim().toLowerCase();
  if (t === "true" || t === "1" || t === "yes") return true;
  if (t === "false" || t === "0" || t === "no") return false;
  return defaultFalse;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Safe at module load and runtime: never throws; missing key yields disabled runtime paths.
 */
export function loadOpenClawEnv(): OpenClawEnvConfig {
  const enabled = parseBool(process.env.OPENCLAW_ENABLED, false);
  const apiKey =
    process.env.OPENCLAW_API_KEY?.trim() ||
    process.env.RR_API_KEY?.trim() ||
    null;

  const baseUrl =
    process.env.OPENCLAW_BASE_URL?.trim() || "https://www.remoterocketship.com";
  const apiPath =
    process.env.OPENCLAW_API_PATH?.trim() || "/api/openclaw/jobs";

  const timeoutMs = clamp(Number(process.env.OPENCLAW_TIMEOUT_MS ?? "8000") || 8000, 1000, 120_000);
  const maxRequestsPerDay = clamp(
    Number(process.env.OPENCLAW_MAX_REQUESTS_PER_DAY ?? "900") || 900,
    1,
    50_000,
  );
  const quotaReserve = clamp(
    Number(process.env.OPENCLAW_QUOTA_RESERVE ?? "100") || 100,
    0,
    maxRequestsPerDay - 1,
  );

  return {
    enabled,
    apiKey,
    baseUrl: baseUrl.replace(/\/$/, ""),
    apiPath: apiPath.startsWith("/") ? apiPath : `/${apiPath}`,
    timeoutMs,
    maxRequestsPerDay,
    quotaReserve,
    syncEnabled: parseBool(process.env.OPENCLAW_SYNC_ENABLED, false),
    discoveryEnabled: parseBool(process.env.OPENCLAW_DISCOVERY_ENABLED, true),
    enrichmentEnabled: parseBool(process.env.OPENCLAW_ENRICHMENT_ENABLED, true),
    dryRun: parseBool(process.env.OPENCLAW_DRY_RUN, true),
    cacheTtlSec: clamp(Number(process.env.OPENCLAW_CACHE_TTL_SEC ?? "300") || 300, 0, 3600),
    syncIntervalMs: clamp(
      Number(process.env.OPENCLAW_SYNC_INTERVAL_MS ?? String(4 * 60 * 60 * 1000)) ||
        4 * 60 * 60 * 1000,
      60_000,
      48 * 60 * 60 * 1000,
    ),
    itemsPerPage: clamp(Number(process.env.OPENCLAW_ITEMS_PER_PAGE ?? "40") || 40, 1, 100),
    maxPagesPerRun: clamp(Number(process.env.OPENCLAW_MAX_PAGES_PER_RUN ?? "3") || 3, 1, 50),
    circuitFailureThreshold: clamp(
      Number(process.env.OPENCLAW_CIRCUIT_FAILURE_THRESHOLD ?? "5") || 5,
      1,
      50,
    ),
    circuitCooldownMs: clamp(
      Number(process.env.OPENCLAW_CIRCUIT_COOLDOWN_MS ?? String(5 * 60 * 1000)) ||
        5 * 60 * 1000,
      10_000,
      24 * 60 * 60 * 1000,
    ),
    maxHttpRetries: clamp(Number(process.env.OPENCLAW_HTTP_RETRIES ?? "2") || 2, 0, 5),
  };
}

export function isOpenClawConfiguredForSync(cfg: OpenClawEnvConfig): boolean {
  return cfg.enabled && cfg.syncEnabled && Boolean(cfg.apiKey?.trim());
}
