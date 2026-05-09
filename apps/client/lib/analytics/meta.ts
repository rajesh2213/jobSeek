"use client";

import { isClientAnalyticsAllowed, isMetaAnalyticsVerbose, isMetaPixelEnabled } from "./config";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    _fbq?: (...args: unknown[]) => void;
  }
}

function logVerbose(message: string, data?: Record<string, unknown>): void {
  if (!isMetaAnalyticsVerbose()) return;
  try {
    // eslint-disable-next-line no-console
    console.debug(`[meta] ${message}`, data ?? "");
  } catch {
    /* ignore */
  }
}

export function trackMetaPageView(): void {
  if (typeof window === "undefined") return;
  if (!isMetaPixelEnabled() || !isClientAnalyticsAllowed()) return;
  try {
    window.fbq?.("track", "PageView");
    logVerbose("PageView");
  } catch {
    /* fail silent */
  }
}

export function trackMetaStandard(
  event: string,
  params?: Record<string, unknown>,
  options?: { eventID?: string },
): void {
  if (typeof window === "undefined") return;
  if (!isMetaPixelEnabled() || !isClientAnalyticsAllowed()) return;
  try {
    const args: unknown[] = options?.eventID
      ? [event, params ?? {}, { eventID: options.eventID }]
      : [event, params ?? {}];
    window.fbq?.("track", ...args);
    logVerbose(event, { ...(params as object), eventID: options?.eventID });
  } catch {
    /* ignore */
  }
}

export function trackMetaCustom(
  event: string,
  params?: Record<string, unknown>,
  options?: { eventID?: string },
): void {
  if (typeof window === "undefined") return;
  if (!isMetaPixelEnabled() || !isClientAnalyticsAllowed()) return;
  try {
    const args: unknown[] = options?.eventID
      ? ["trackCustom", event, params ?? {}, { eventID: options.eventID }]
      : ["trackCustom", event, params ?? {}];
    window.fbq?.(...args);
    logVerbose(`Custom:${event}`, { ...(params as object), eventID: options?.eventID });
  } catch {
    /* ignore */
  }
}
