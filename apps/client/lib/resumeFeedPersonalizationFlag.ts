/** Client build-time flag for Phase 8A recommended jobs section. */
export function isResumeFeedPersonalizationEnabled(): boolean {
  const raw = (process.env.NEXT_PUBLIC_RESUME_FEED_PERSONALIZATION ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true";
}

export type FeedPersonalizationVariant = "control" | "carousel";

/** Experiment variant for Phase 8C — flag off = control, flag on = carousel. */
export function getFeedPersonalizationVariant(): FeedPersonalizationVariant {
  return isResumeFeedPersonalizationEnabled() ? "carousel" : "control";
}
