"use client";

import { getPersistedAttribution } from "./attribution";
import { trackMetaCustom } from "./meta";
import { postMetaAnalyticsSync } from "./sync";

function attributionCustomData(): Record<string, string> {
  const a = getPersistedAttribution();
  if (!a) return {};
  const o: Record<string, string> = {};
  if (a.utm_source) o.utm_source = a.utm_source;
  if (a.utm_medium) o.utm_medium = a.utm_medium;
  if (a.utm_campaign) o.utm_campaign = a.utm_campaign;
  if (a.fbclid) o.fbclid = a.fbclid;
  return o;
}

/** Successful resume file upload (client-side funnel). */
export async function trackResumeUploaded(params: {
  getToken: () => Promise<string | null>;
  source?: string;
}): Promise<void> {
  const eventId = crypto.randomUUID();
  const custom = {
    source: params.source ?? "resume_upload_modal",
    ...attributionCustomData(),
  };
  trackMetaCustom("ResumeUploaded", custom, { eventID: eventId });
  const token = await params.getToken();
  if (!token) return;
  void postMetaAnalyticsSync(token, {
    eventName: "ResumeUploaded",
    eventId,
    sourceUrl: typeof window !== "undefined" ? window.location.href : undefined,
    customData: custom,
  });
}

const FIRST_MATCH_SESSION_KEY = "jobloom.analytics.firstResumeMatchViewed";

/** First AI resume match score viewed this browser session (deduped). */
export async function trackResumeFirstMatchViewedOnce(params: {
  getToken: () => Promise<string | null>;
  jobId: string;
  planTier: "free" | "pro";
  score: number;
}): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    if (window.sessionStorage.getItem(FIRST_MATCH_SESSION_KEY) === "1") return;
    window.sessionStorage.setItem(FIRST_MATCH_SESSION_KEY, "1");
  } catch {
    return;
  }
  const eventId = crypto.randomUUID();
  const custom = {
    job_id: params.jobId,
    plan_tier: params.planTier,
    score: String(params.score),
    ...attributionCustomData(),
  };
  trackMetaCustom("ResumeFirstMatchViewed", custom, { eventID: eventId });
  const token = await params.getToken();
  if (!token) return;
  void postMetaAnalyticsSync(token, {
    eventName: "ResumeFirstMatchViewed",
    eventId,
    sourceUrl: typeof window !== "undefined" ? window.location.href : undefined,
    customData: custom,
  });
}

export function trackResumeMatchQuotaHit(params: { remaining: number; jobId?: string }): void {
  trackMetaCustom("ResumeMatchQuotaHit", {
    remaining: String(params.remaining),
    ...(params.jobId ? { job_id: params.jobId } : {}),
    ...attributionCustomData(),
  });
}

export function trackResumeMatchUpgradeClick(params: { surface: string; jobId?: string }): void {
  trackMetaCustom("ResumeMatchUpgradeClick", {
    surface: params.surface,
    ...(params.jobId ? { job_id: params.jobId } : {}),
    ...attributionCustomData(),
  });
}

/** Job listing had no extractable skills/keywords — match not scored (no quota consumed). */
export function trackResumeMatchUnscorable(params: { jobId: string }): void {
  trackMetaCustom("ResumeMatchUnscorable", {
    job_id: params.jobId,
    ...attributionCustomData(),
  });
}
