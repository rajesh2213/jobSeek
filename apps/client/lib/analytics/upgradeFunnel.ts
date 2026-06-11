"use client";

import posthog from "posthog-js";
import { getPersistedAttribution } from "./attribution";
import { trackMetaCustom } from "./meta";

export type UpgradeTrigger =
  | "browse_limit"
  | "resume_match_quota"
  | "browse_nearing"
  | "resume_keywords"
  | "job_alerts"
  | "smart_apply"
  | "job_apply"
  | "account"
  | "header_nav"
  | "unknown";

export type UpgradeSurface =
  | "header_nav"
  | "mobile_menu"
  | "drawer"
  | "pricing_banner"
  | "limit_wall"
  | "resume_score_pill"
  | "pro_gate"
  | "jobs_search"
  | "account"
  | "inline";

export type UpgradeCtaType =
  | "nav_link"
  | "drawer_primary"
  | "drawer_secondary"
  | "drawer_monthly"
  | "inline"
  | "checkout";

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

function baseProps(params: {
  trigger?: UpgradeTrigger;
  surface?: UpgradeSurface;
  cta_type?: UpgradeCtaType;
  from?: string;
}): Record<string, string> {
  return {
    ...(params.trigger ? { trigger: params.trigger } : {}),
    ...(params.surface ? { surface: params.surface } : {}),
    ...(params.cta_type ? { cta_type: params.cta_type } : {}),
    ...(params.from ? { from: params.from } : {}),
    ...attributionCustomData(),
  };
}

export function trackUpgradePromptShown(params: {
  trigger: UpgradeTrigger;
  surface: UpgradeSurface;
  from?: string;
}): void {
  const props = baseProps(params);
  trackMetaCustom("UpgradePromptShown", props);
  if (typeof window !== "undefined" && posthog.__loaded) {
    posthog.capture("upgrade_prompt_shown", props);
  }
}

export function trackUpgradePromptClick(params: {
  trigger: UpgradeTrigger;
  surface: UpgradeSurface;
  cta_type: UpgradeCtaType;
  from?: string;
}): void {
  const props = baseProps(params);
  trackMetaCustom("UpgradePromptClick", props);
  if (typeof window !== "undefined" && posthog.__loaded) {
    posthog.capture("upgrade_prompt_click", props);
  }
}

export function trackCheckoutStarted(params: {
  trigger: UpgradeTrigger;
  plan_type: "monthly" | "yearly";
  provider: "paypal" | "dodo";
  surface?: UpgradeSurface;
}): void {
  const props = {
    ...baseProps({ trigger: params.trigger, surface: params.surface }),
    plan_type: params.plan_type,
    provider: params.provider,
  };
  trackMetaCustom("CheckoutStarted", props);
  if (typeof window !== "undefined" && posthog.__loaded) {
    posthog.capture("checkout_started", props);
  }
}

export function trackSubscriptionActivated(params: {
  trigger: UpgradeTrigger;
  plan_type?: "monthly" | "yearly";
  provider?: "paypal" | "dodo";
  time_to_activate_ms?: number;
}): void {
  const props = {
    ...baseProps({ trigger: params.trigger }),
    ...(params.plan_type ? { plan_type: params.plan_type } : {}),
    ...(params.provider ? { provider: params.provider } : {}),
    ...(params.time_to_activate_ms != null
      ? { time_to_activate_ms: String(params.time_to_activate_ms) }
      : {}),
  };
  trackMetaCustom("SubscriptionActivated", props);
  if (typeof window !== "undefined" && posthog.__loaded) {
    posthog.capture("subscription_activated", props);
  }
}
