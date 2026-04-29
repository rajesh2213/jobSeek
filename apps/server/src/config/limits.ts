import { loadRootEnv } from "../infrastructure/env/loadEnv.js";

export type CapMode = "soft" | "hard";

// Ensure env is loaded before LIMITS is computed at module evaluation time.
loadRootEnv();

function toPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function capMode(): CapMode {
  const raw = (process.env.CAP_MODE ?? "soft").trim().toLowerCase();
  return raw === "hard" ? "hard" : "soft";
}

export const LIMITS = {
  MODE: capMode(),
  FREE_TIER_DAILY_LIMIT: toPositiveInt(process.env.FREE_TIER_DAILY_LIMIT, 75),
  DISCOVERY: {
    PREVIEW_ROWS: toPositiveInt(process.env.FREE_DISCOVERY_PREVIEW_ROWS, 10),
  },
} as const;
