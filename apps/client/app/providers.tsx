"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { isPosthogClientCaptureAllowed } from "../lib/analytics/config";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim() ?? "";
/** Ingest / reverse-proxy origin only — no trailing slash (PostHog appends paths like `/e/`). */
const POSTHOG_HOST = (process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() ?? "").replace(/\/+$/, "");
/**
 * Required when `POSTHOG_HOST` is a custom proxy. US: `https://us.posthog.com` · EU: `https://eu.posthog.com`
 * (see https://posthog.com/docs/advanced/proxy ).
 */
const POSTHOG_UI_HOST = (process.env.NEXT_PUBLIC_POSTHOG_UI_HOST?.trim() ?? "").replace(/\/+$/, "");
const POSTHOG_DEBUG = process.env.NEXT_PUBLIC_POSTHOG_DEBUG?.trim() === "true";

function PosthogInit(): null {
  useEffect(() => {
    if (!POSTHOG_KEY || !POSTHOG_HOST) {
      if (POSTHOG_DEBUG) console.warn("[PostHog] skipped init: missing NEXT_PUBLIC_POSTHOG_KEY or NEXT_PUBLIC_POSTHOG_HOST");
      return;
    }
    if (!isPosthogClientCaptureAllowed()) {
      if (POSTHOG_DEBUG) console.warn("[PostHog] skipped init: analytics opt-out (jobloom_analytics=0)");
      return;
    }
    if (posthog.__loaded) return;

    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      ...(POSTHOG_UI_HOST ? { ui_host: POSTHOG_UI_HOST } : {}),
      capture_pageview: true,
      capture_pageleave: true,
      person_profiles: "identified_only",
      loaded: () => {
        if (POSTHOG_DEBUG) console.info("[PostHog] initialized", { api_host: POSTHOG_HOST });
      },
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
