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
  if (a.utm_term) o.utm_term = a.utm_term;
  if (a.utm_content) o.utm_content = a.utm_content;
  if (a.fbclid) o.fbclid = a.fbclid;
  return o;
}

/** First successful Smart Apply profile save in a browser session (extension autofill uses server `fill_completed`). */
export async function trackSmartApplyProfileSaveOnce(params: {
  getToken: () => Promise<string | null>;
}): Promise<void> {
  const eventId = crypto.randomUUID();
  const custom = {
    source: "smart_apply_profile_save",
    ...attributionCustomData(),
  };
  trackMetaCustom("SmartApplyUsed", custom, { eventID: eventId });
  const token = await params.getToken();
  if (!token) return;
  void postMetaAnalyticsSync(token, {
    eventName: "SmartApplyUsed",
    eventId,
    sourceUrl: typeof window !== "undefined" ? window.location.href : undefined,
    customData: custom,
  });
}
