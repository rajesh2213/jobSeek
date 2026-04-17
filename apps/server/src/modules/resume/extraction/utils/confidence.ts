import type { ConfidenceLevel } from "../types.js";

const RANK: Record<ConfidenceLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

export function setConfidence(
  conf: Record<string, ConfidenceLevel>,
  key: string,
  level: ConfidenceLevel,
): void {
  const prev = conf[key];
  if (!prev || RANK[level] > RANK[prev]) {
    conf[key] = level;
  }
}
