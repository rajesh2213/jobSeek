import type { UpgradeTrigger } from "./analytics/upgradeFunnel";

export const UPGRADE_DISMISS_PREFIX = "jobloom.upgradeDismissed.";
export const UPGRADE_DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const CHECKOUT_ATTRIBUTION_KEY = "jobloom.checkoutAttribution";

export type UpgradeFromParam = UpgradeTrigger | string;

export type UpgradeTriggerCopy = {
  headline: string;
  subcopy: string;
  bullets: string[];
  pricingBanner: string;
};

export const UPGRADE_TRIGGER_COPY: Record<UpgradeTrigger, UpgradeTriggerCopy> = {
  browse_limit: {
    headline: "Unlock more jobs in this search",
    subcopy: "Pro removes the daily browse cap so you can see every listing that matches.",
    bullets: [
      "Unlimited job browsing across search and company pages",
      "Resume match on every role — full score and gap analysis",
      "Email job alerts when new roles match your saved searches",
    ],
    pricingBanner: "You hit today's browse limit — Pro gives unlimited access.",
  },
  resume_match_quota: {
    headline: "Keep checking fit on every role",
    subcopy: "You've used your free AI resume matches for today. Pro unlocks unlimited semantic matching.",
    bullets: [
      "Unlimited AI resume match — keywords, gaps, and line-level context",
      "Smart Apply to fill ATS forms in minutes",
      "Unlimited job browsing and job alerts",
    ],
    pricingBanner: "You've used your free AI matches — Pro unlocks unlimited resume fit checks.",
  },
  browse_nearing: {
    headline: "You're nearing today's browse limit",
    subcopy: "Upgrade before you hit the cap to keep exploring without interruption.",
    bullets: [
      "Unlimited job browsing",
      "Unlimited AI resume match",
      "Job alerts for saved searches",
    ],
    pricingBanner: "You're nearing today's browse limit — upgrade for uninterrupted access.",
  },
  resume_keywords: {
    headline: "See keyword-level fit with Pro",
    subcopy: "Your overall score is free. Pro shows matched skills, partial matches, and gap analysis.",
    bullets: [
      "Full resume breakdown and missing keywords",
      "Unlimited AI semantic matching",
      "Smart Apply and job alerts",
    ],
    pricingBanner: "Keyword-level fit and gap analysis are Pro features.",
  },
  job_alerts: {
    headline: "Get emailed when new roles match",
    subcopy: "Job alerts are a Pro feature — be first when listings match your saved searches.",
    bullets: [
      "Email alerts when 5 or 10 new jobs match",
      "Unlimited browsing and resume match",
      "Smart Apply for faster applications",
    ],
    pricingBanner: "Job alerts require Pro — get notified when new roles match.",
  },
  smart_apply: {
    headline: "Unlock Smart Apply",
    subcopy: "Pro lets you auto-fill standard ATS fields and get AI help on open-ended questions.",
    bullets: [
      "Chrome extension auto-fill for ATS forms",
      "AI-written answers for open-ended fields",
      "Up to 5 Smart Apply jobs per day",
    ],
    pricingBanner: "Smart Apply is a Pro feature.",
  },
  job_apply: {
    headline: "Upgrade to view and apply",
    subcopy: "This job post is beyond your free daily view limit. Pro unlocks full posts and apply links.",
    bullets: [
      "Unlimited full job post views",
      "Resume match before you apply",
      "Smart Apply and job alerts",
    ],
    pricingBanner: "Upgrade to view full job posts and apply beyond your daily limit.",
  },
  account: {
    headline: "Upgrade to Pro",
    subcopy: "Unlock unlimited browsing, resume insights, Smart Apply, and job alerts.",
    bullets: [
      "Unlimited job browsing",
      "Unlimited AI resume match",
      "Smart Apply and job alerts",
    ],
    pricingBanner: "Upgrade from your account to unlock Pro features.",
  },
  header_nav: {
    headline: "Go Pro",
    subcopy: "Unlimited browsing, resume match, Smart Apply, and job alerts.",
    bullets: [
      "Unlimited job browsing",
      "Unlimited AI resume match",
      "Smart Apply and job alerts",
    ],
    pricingBanner: "Compare Pro plans and choose what fits your search.",
  },
  unknown: {
    headline: "Upgrade to Pro",
    subcopy: "Unlock unlimited browsing, resume insights, Smart Apply, and job alerts.",
    bullets: [
      "Unlimited job browsing",
      "Unlimited AI resume match",
      "Smart Apply and job alerts",
    ],
    pricingBanner: "Upgrade to unlock Pro features.",
  },
};

export function pricingUrl(from?: UpgradeFromParam): string {
  if (!from || from === "unknown") return "/pricing";
  return `/pricing?from=${encodeURIComponent(from)}`;
}

export function parseUpgradeFromParam(raw: string | null): UpgradeTrigger {
  if (!raw) return "unknown";
  if (raw in UPGRADE_TRIGGER_COPY) return raw as UpgradeTrigger;
  return "unknown";
}

export function dismissKey(trigger: UpgradeTrigger): string {
  return `${UPGRADE_DISMISS_PREFIX}${trigger}`;
}

export function isUpgradeDismissed(trigger: UpgradeTrigger): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(dismissKey(trigger));
    if (!raw) return false;
    const ts = Number.parseInt(raw, 10);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < UPGRADE_DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

export function dismissUpgradePrompt(trigger: UpgradeTrigger): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(dismissKey(trigger), String(Date.now()));
  } catch {
    /* ignore */
  }
}

export type CheckoutAttribution = {
  trigger: UpgradeTrigger;
  startedAt: number;
};

export function storeCheckoutAttribution(trigger: UpgradeTrigger): void {
  if (typeof window === "undefined") return;
  try {
    const payload: CheckoutAttribution = { trigger, startedAt: Date.now() };
    window.localStorage.setItem(CHECKOUT_ATTRIBUTION_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function readCheckoutAttribution(): CheckoutAttribution | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CHECKOUT_ATTRIBUTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CheckoutAttribution;
    if (!parsed?.trigger || !parsed.startedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearCheckoutAttribution(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CHECKOUT_ATTRIBUTION_KEY);
  } catch {
    /* ignore */
  }
}

export function headlineForTrigger(
  trigger: UpgradeTrigger,
  context?: { nHidden?: number },
): string {
  const copy = UPGRADE_TRIGGER_COPY[trigger] ?? UPGRADE_TRIGGER_COPY.unknown;
  if (trigger === "browse_limit" && context?.nHidden != null && context.nHidden > 0) {
    return `Unlock ${context.nHidden.toLocaleString()} more jobs in this search`;
  }
  return copy.headline;
}
