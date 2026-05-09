import { logger } from "../../../../utils/logger.js";
import { DEFAULT_ATS_FETCH_RETRY } from "../../../../utils/fetchWithRetry.js";
import type { OpenClawEnvConfig } from "./openclaw.env.js";
import {
  isOpenClawCircuitOpen,
  markOpenClawAttempt,
  markOpenClawSuccess,
  recordOpenClawCircuitFailure,
  resetOpenClawCircuitSuccess,
  setOpenClawHealth,
} from "./openclaw.state.js";
import { tryConsumeOpenClawQuotaSlot, type QuotaCheckResult } from "./openclaw.quota.js";
import type { OpenClawJobsSearchRequest } from "./openclaw.types.js";
import type { Redis } from "ioredis";

export type OpenClawFetchResult =
  | { ok: true; status: number; json: unknown; rawText: string }
  | {
      ok: false;
      kind:
        | "disabled"
        | "missing_key"
        | "quota_blocked"
        | "circuit_open"
        | "unauthorized"
        | "rate_limited"
        | "timeout"
        | "network"
        | "http_error"
        | "invalid_json";
      status?: number;
      message?: string;
    };

/**
 * HTTP policy vs `fetchWithRetry.ts`:
 * - Shared: retryable 5xx uses similar linear backoff base as `DEFAULT_ATS_FETCH_RETRY.baseDelayMs`.
 * - Different: 401/403 must not retry (subscription/key); 429 fails fast here to conserve daily quota
 *   (`fetchWithRetry` retries 429 up to maxAttempts — too costly for OpenClaw).
 * - Circuit breaker + quota gate are OpenClaw-only (not in fetchWithRetry).
 */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function buildUrl(cfg: OpenClawEnvConfig): string {
  return `${cfg.baseUrl}${cfg.apiPath}`;
}

function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export class OpenClawClient {
  constructor(
    private readonly cfg: OpenClawEnvConfig,
    private readonly getRedis: () => Redis | null,
  ) {}

  /**
   * POST jobs search. Never logs secrets. On 401/403 returns ok:false without throwing.
   */
  async fetchJobsSearch(body: OpenClawJobsSearchRequest): Promise<OpenClawFetchResult> {
    const now = Date.now();
    if (!this.cfg.enabled) {
      setOpenClawHealth("disabled", "OPENCLAW_ENABLED=false", null);
      return { ok: false, kind: "disabled", message: "provider_disabled" };
    }
    if (!this.cfg.apiKey?.trim()) {
      setOpenClawHealth("disabled", "missing_api_key", "missing_key");
      return { ok: false, kind: "missing_key", message: "missing_api_key" };
    }
    if (isOpenClawCircuitOpen(now)) {
      setOpenClawHealth("degraded", "circuit_breaker_open", "circuit_open");
      return { ok: false, kind: "circuit_open", message: "circuit_open" };
    }

    const redis = this.getRedis();
    const quota: QuotaCheckResult = await tryConsumeOpenClawQuotaSlot(
      redis,
      this.cfg.maxRequestsPerDay,
      this.cfg.quotaReserve,
    );
    if (!quota.allowed) {
      setOpenClawHealth("quota_exceeded", "daily_quota_or_redis", quota.redisAvailable ? "quota" : "redis");
      logger.warn(
        {
          event: "quota_exceeded",
          provider: "openclaw",
          used: quota.used,
          limit: quota.limit,
          redis_ok: quota.redisAvailable,
        },
        "openclaw_quota_blocked",
      );
      return {
        ok: false,
        kind: "quota_blocked",
        message: quota.redisAvailable ? "quota_exceeded" : "redis_unavailable",
      };
    }

    markOpenClawAttempt();
    const url = buildUrl(this.cfg);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);

    let attempt = 0;
    let lastStatus = 0;
    let lastText = "";

    try {
      while (attempt <= this.cfg.maxHttpRetries) {
        attempt += 1;
        let res: Response;
        try {
          res = await fetch(url, {
            method: "POST",
            headers: {
              authorization: `Bearer ${this.cfg.apiKey}`,
              "content-type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } catch (err) {
          const name = err instanceof Error ? err.name : "";
          const isAbort = name === "AbortError";
          if (isAbort) {
            setOpenClawHealth("degraded", "timeout", "timeout");
            return { ok: false, kind: "timeout", message: "request_timeout" };
          }
          recordOpenClawCircuitFailure(now, this.cfg.circuitCooldownMs, this.cfg.circuitFailureThreshold);
          setOpenClawHealth("degraded", "network_error", "network");
          return { ok: false, kind: "network", message: err instanceof Error ? err.message : "fetch_failed" };
        }

        lastStatus = res.status;
        lastText = await res.text().catch(() => "");

        if (res.status === 401 || res.status === 403) {
          resetOpenClawCircuitSuccess();
          setOpenClawHealth("unauthorized", `http_${res.status}`, "unauthorized");
          logger.warn(
            { event: "provider_disabled", provider: "openclaw", reason: "unauthorized", status: res.status },
            "openclaw_unauthorized_soft_disable",
          );
          return { ok: false, kind: "unauthorized", status: res.status, message: lastText.slice(0, 500) };
        }

        if (res.status === 429) {
          recordOpenClawCircuitFailure(now, this.cfg.circuitCooldownMs, this.cfg.circuitFailureThreshold);
          setOpenClawHealth("degraded", "rate_limited", "429");
          logger.warn(
            { event: "openclaw_rate_limited", provider: "openclaw", status: res.status },
            "openclaw_rate_limited",
          );
          return { ok: false, kind: "rate_limited", status: res.status, message: lastText.slice(0, 500) };
        }

        if (res.status >= 500 && attempt <= this.cfg.maxHttpRetries) {
          const backoff = Math.min(
            30_000,
            DEFAULT_ATS_FETCH_RETRY.baseDelayMs * attempt + Math.floor(Math.random() * 150),
          );
          logger.warn(
            { event: "openclaw_retry", provider: "openclaw", status: res.status, attempt, backoff },
            "openclaw_retry",
          );
          await sleep(backoff);
          continue;
        }

        if (!res.ok) {
          recordOpenClawCircuitFailure(now, this.cfg.circuitCooldownMs, this.cfg.circuitFailureThreshold);
          setOpenClawHealth("degraded", `http_${res.status}`, "http_error");
          return {
            ok: false,
            kind: "http_error",
            status: res.status,
            message: lastText.slice(0, 500),
          };
        }

        const json = safeJsonParse(lastText);
        if (json === null) {
          recordOpenClawCircuitFailure(now, this.cfg.circuitCooldownMs, this.cfg.circuitFailureThreshold);
          setOpenClawHealth("degraded", "invalid_json", "invalid_json");
          return { ok: false, kind: "invalid_json", status: res.status, message: "json_parse_failed" };
        }

        resetOpenClawCircuitSuccess();
        markOpenClawSuccess();
        return { ok: true, status: res.status, json, rawText: lastText };
      }

      recordOpenClawCircuitFailure(now, this.cfg.circuitCooldownMs, this.cfg.circuitFailureThreshold);
      return {
        ok: false,
        kind: "http_error",
        status: lastStatus,
        message: lastText.slice(0, 500),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
