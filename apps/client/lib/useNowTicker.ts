"use client";

import { useEffect, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let tickerId: number | null = null;
let activeSubscribers = 0;
let minuteTick = Math.floor(Date.now() / 60_000);

function emitIfMinuteChanged(): void {
  const next = Math.floor(Date.now() / 60_000);
  if (next === minuteTick) return;
  minuteTick = next;
  listeners.forEach((l) => l());
}

function startTicker(): void {
  if (tickerId != null || activeSubscribers <= 0) return;
  tickerId = window.setInterval(emitIfMinuteChanged, 30_000);
}

function stopTicker(): void {
  if (tickerId == null || activeSubscribers > 0) return;
  window.clearInterval(tickerId);
  tickerId = null;
}

function subscribeGlobal(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getGlobalSnapshot(): number {
  return minuteTick;
}

/**
 * Shared minute ticker for "time ago" labels.
 * `enabled` lets callers avoid subscriptions for off-screen rows.
 */
export function useNowTicker(enabled: boolean): number {
  const tick = useSyncExternalStore(
    (onStoreChange) => (enabled ? subscribeGlobal(onStoreChange) : () => {}),
    () => (enabled ? getGlobalSnapshot() : -1),
    () => -1,
  );

  useEffect(() => {
    if (!enabled) return;
    activeSubscribers += 1;
    startTicker();
    return () => {
      activeSubscribers = Math.max(0, activeSubscribers - 1);
      stopTicker();
    };
  }, [enabled]);

  return tick;
}
