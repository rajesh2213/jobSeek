import type { ProviderHealthState } from "../../provider.types.js";

export interface OpenClawCircuitState {
  failures: number;
  openUntil: number;
}

const state: {
  health: ProviderHealthState;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastErrorKind: string | null;
  disabledReason: string | null;
  circuit: OpenClawCircuitState;
} = {
  health: "disabled",
  lastSuccessAt: null,
  lastAttemptAt: null,
  lastErrorKind: null,
  disabledReason: null,
  circuit: { failures: 0, openUntil: 0 },
};

export function getOpenClawStateSnapshot(): typeof state {
  return { ...state, circuit: { ...state.circuit } };
}

export function setOpenClawHealth(
  health: ProviderHealthState,
  reason: string | null,
  errorKind: string | null,
): void {
  state.health = health;
  state.disabledReason = reason;
  state.lastErrorKind = errorKind;
}

export function markOpenClawAttempt(): void {
  state.lastAttemptAt = new Date().toISOString();
}

export function markOpenClawSuccess(): void {
  state.health = "healthy";
  state.lastSuccessAt = new Date().toISOString();
  state.disabledReason = null;
  state.lastErrorKind = null;
  state.circuit.failures = 0;
  state.circuit.openUntil = 0;
}

export function recordOpenClawCircuitFailure(now: number, cooldownMs: number, threshold: number): void {
  state.circuit.failures += 1;
  if (state.circuit.failures >= threshold) {
    state.circuit.openUntil = now + cooldownMs;
    state.health = "degraded";
    state.lastErrorKind = "circuit_open";
  }
}

export function resetOpenClawCircuitSuccess(): void {
  state.circuit.failures = 0;
  state.circuit.openUntil = 0;
}

export function isOpenClawCircuitOpen(now: number): boolean {
  return now < state.circuit.openUntil;
}
