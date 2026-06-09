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

/** Fit score viewed with confidence tier (Phase 1). */
export function trackResumeFitViewed(params: {
  jobId: string;
  score: number;
  confidence: string;
  fitTier: number | null;
}): void {
  trackMetaCustom("ResumeFitViewed", {
    job_id: params.jobId,
    score: String(params.score),
    confidence: params.confidence,
    fit_tier: params.fitTier == null ? "" : String(params.fitTier),
    ...attributionCustomData(),
  });
}

export function trackResumeFitUnavailable(params: { reason: string; jobId?: string }): void {
  trackMetaCustom("ResumeFitUnavailable", {
    reason: params.reason,
    ...(params.jobId ? { job_id: params.jobId } : {}),
    ...attributionCustomData(),
  });
}

/** Phase 6 production monitoring — unavailable breakdown by family and signals. */
export function trackResumeFitUnavailableReason(params: {
  reason: string;
  candidateFamily: string | null;
  jobFamily: string | null;
  signalCount: number;
  jobId?: string;
}): void {
  trackMetaCustom("ResumeFitUnavailableReason", {
    reason: params.reason,
    candidate_family: params.candidateFamily ?? "",
    job_family: params.jobFamily ?? "",
    signal_count: String(params.signalCount),
    ...(params.jobId ? { job_id: params.jobId } : {}),
    ...attributionCustomData(),
  });
}

export function trackResumeFitConfidence(params: {
  confidence: string;
  signalCount: number;
  jobId?: string;
}): void {
  trackMetaCustom("ResumeFitConfidence", {
    confidence: params.confidence,
    signal_count: String(params.signalCount),
    ...(params.jobId ? { job_id: params.jobId } : {}),
    ...attributionCustomData(),
  });
}

export function trackResumeFitExperienceEvaluated(params: {
  jobId?: string;
  candidateYears: number | null;
  requiredYears: number | null;
  experienceFitScore: number | null;
}): void {
  trackMetaCustom("ResumeFitExperienceEvaluated", {
    ...(params.jobId ? { job_id: params.jobId } : {}),
    candidate_years: params.candidateYears == null ? "" : String(params.candidateYears),
    required_years: params.requiredYears == null ? "" : String(params.requiredYears),
    experience_fit_score:
      params.experienceFitScore == null ? "" : String(params.experienceFitScore),
    ...attributionCustomData(),
  });
}

export function trackResumeFitTitleEvaluated(params: {
  jobId?: string;
  candidateFamily: string | null;
  jobFamily: string | null;
  titleFit: number | null;
}): void {
  trackMetaCustom("ResumeFitTitleEvaluated", {
    ...(params.jobId ? { job_id: params.jobId } : {}),
    candidate_family: params.candidateFamily ?? "",
    job_family: params.jobFamily ?? "",
    title_fit: params.titleFit == null ? "" : String(params.titleFit),
    ...attributionCustomData(),
  });
}

export function trackResumeFitSeniorityEvaluated(params: {
  jobId?: string;
  candidateLevel: number | null;
  jobLevel: number | null;
  seniorityFitScore: number | null;
}): void {
  trackMetaCustom("ResumeFitSeniorityEvaluated", {
    ...(params.jobId ? { job_id: params.jobId } : {}),
    candidate_level: params.candidateLevel == null ? "" : String(params.candidateLevel),
    job_level: params.jobLevel == null ? "" : String(params.jobLevel),
    seniority_fit_score:
      params.seniorityFitScore == null ? "" : String(params.seniorityFitScore),
    ...attributionCustomData(),
  });
}
