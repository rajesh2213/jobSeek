/**
 * Optional third-party ingestion / discovery providers (OpenClaw, etc.).
 * Core JobLoom pipelines must not depend on these types at compile-time beyond loose coupling.
 */

export type ProviderId = "openclaw";

export type ProviderHealthState =
  | "healthy"
  | "degraded"
  | "disabled"
  | "quota_exceeded"
  | "unauthorized";

export interface ProviderCapabilityMeta {
  id: ProviderId;
  /** Human-readable label for logs / metrics. */
  label: string;
  supportsJobIngestion: boolean;
  supportsCompanyDiscovery: boolean;
  supportsAtsHints: boolean;
  /** Declared soft cap — informational; enforcement is env-driven. */
  defaultRateLimitRequestsPerDay: number;
}

export interface ProviderRuntimeSnapshot {
  id: ProviderId;
  health: ProviderHealthState;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastErrorKind: string | null;
  quotaRemainingEstimate: number | null;
  /** Successful quota INCR count today (API calls admitted), if Redis available. */
  quotaUsedToday: number | null;
  circuitOpenUntil: number | null;
  disabledReason: string | null;
}
