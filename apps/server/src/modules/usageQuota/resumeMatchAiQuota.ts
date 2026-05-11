import type { Redis } from "ioredis";
import { LIMITS } from "../../config/limits.js";
import {
  newQuotaMemberId,
  peekRollingWindowQuota,
  releaseRollingWindowQuotaMember,
  reserveRollingWindowQuota,
} from "./rollingWindowQuota.redis.js";

const WINDOW_MS = 86_400_000;

export function resumeMatchAiQuotaKey(internalUserId: string): string {
  return `quota:ai:resume_match:${internalUserId}`;
}

export function freeResumeMatchAiDailyMax(): number {
  return LIMITS.FREE_RESUME_MATCH_AI_PER_24H;
}

export async function peekFreeResumeMatchAiQuota(
  redis: Redis,
  internalUserId: string,
): Promise<{ limit: number; used: number; remaining: number; resetAtMs: number }> {
  const limit = freeResumeMatchAiDailyMax();
  const nowMs = Date.now();
  const key = resumeMatchAiQuotaKey(internalUserId);
  const p = await peekRollingWindowQuota(redis, key, { nowMs, windowMs: WINDOW_MS, max: limit });
  return {
    limit,
    used: p.used,
    remaining: p.remaining,
    resetAtMs: p.resetAtMs,
  };
}

export async function reserveFreeResumeMatchAiQuota(
  redis: Redis,
  internalUserId: string,
): Promise<
  | { ok: true; memberId: string; used: number; resetAtMs: number; limit: number }
  | { ok: false; used: number; resetAtMs: number; limit: number }
> {
  const limit = freeResumeMatchAiDailyMax();
  const nowMs = Date.now();
  const key = resumeMatchAiQuotaKey(internalUserId);
  const memberId = newQuotaMemberId();
  const r = await reserveRollingWindowQuota(redis, key, {
    nowMs,
    windowMs: WINDOW_MS,
    max: limit,
    memberId,
  });
  if (!r.ok) {
    return { ok: false, used: r.used, resetAtMs: r.resetAtMs, limit };
  }
  return { ok: true, memberId, used: r.used, resetAtMs: r.resetAtMs, limit };
}

export async function releaseFreeResumeMatchAiReservation(
  redis: Redis,
  internalUserId: string,
  memberId: string,
): Promise<void> {
  const key = resumeMatchAiQuotaKey(internalUserId);
  await releaseRollingWindowQuotaMember(redis, key, memberId);
}
