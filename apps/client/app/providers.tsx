"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { isClientAnalyticsAllowed } from "../lib/analytics/config";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim() ?? "";
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() ?? "";

function PosthogInit(): null {
  useEffect(() => {
    if (!POSTHOG_KEY || !POSTHOG_HOST) return;
    if (!isClientAnalyticsAllowed()) return;
    if (posthog.__loaded) return;

    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      capture_pageview: true,
      capture_pageleave: true,
      person_profiles: "identified_only",
    });
  }, []);

  return null;
}

/**
 * Client-only PostHog wiring for the App Router. Safe for SSR: the shell matches with or without keys;
 * init runs only in `useEffect` on the client.
 */
export function PosthogAppProvider({ children }: { children: ReactNode }) {
  if (!POSTHOG_KEY || !POSTHOG_HOST) {
    return children;
  }

  return (
    <PostHogProvider client={posthog}>
      <PosthogInit />
      {children}
    </PostHogProvider>
  );
}
