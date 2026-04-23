type TransitionKey = `${string}->${string}|${string}`;

const transitionTotals = new Map<TransitionKey, number>();
let blockedNotReadyTotal = 0;

export function recordStatusTransition(
  from: string | null,
  to: string,
  reason: string,
): void {
  const fromValue = from ?? "null";
  const key: TransitionKey = `${fromValue}->${to}|${reason}`;
  transitionTotals.set(key, (transitionTotals.get(key) ?? 0) + 1);
}

export function recordJobBlockedNotReady(): void {
  blockedNotReadyTotal += 1;
}

export function getStatusTransitionTotals(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of transitionTotals.entries()) out[key] = value;
  return out;
}

export function getJobsBlockedNotReadyTotal(): number {
  return blockedNotReadyTotal;
}
