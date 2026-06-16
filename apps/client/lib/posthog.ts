"use client";

import posthog from "posthog-js";
import { useEffect, useRef, type DependencyList } from "react";
import type { JobsApiResponse } from "./api";
import type { JobFilters } from "./slug-parser";

/** UTM + referrer context merged into high-value events (client-only reads). */
export type PosthogCampaignProps = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  referrer?: string;
};

const REFERRER_MAX = 512;

export function readPosthogCampaignContext(): PosthogCampaignProps {
  if (typeof window === "undefined") return {};
  try {
    const out: PosthogCampaignProps = {};
    const sp = new URLSearchParams(window.location.search);
    const us = sp.get("utm_source")?.trim();
    const um = sp.get("utm_medium")?.trim();
    const uc = sp.get("utm_campaign")?.trim();
    if (us) out.utm_source = us.slice(0, 160);
    if (um) out.utm_medium = um.slice(0, 160);
    if (uc) out.utm_campaign = uc.slice(0, 160);
    const ref = document.referrer?.trim();
    if (ref) out.referrer = ref.slice(0, REFERRER_MAX);
    return out;
  } catch {
    return {};
  }
}

/** Attribution first, then explicit props (props win on key overlap). */
export function withPosthogAttribution<T extends Record<string, unknown>>(
  props: T,
): T & PosthogCampaignProps {
  return {
    ...(readPosthogCampaignContext() as Record<string, unknown>),
    ...props,
  } as T & PosthogCampaignProps;
}

export type PosthogEventProperties = {
  job_viewed: {
    jobId: string;
    company: string;
    location: string;
    remote: boolean;
    source: string;
  } & PosthogCampaignProps;
  job_search: {
    query?: string;
    location?: string;
    remote?: boolean;
    page?: number;
    sort?: string;
    resultsCount?: number;
  } & PosthogCampaignProps;
  job_apply_clicked: {
    jobId: string;
    company: string;
    source: string;
    isAuthenticated: boolean;
  } & PosthogCampaignProps;
  signup_started: {
    source?: string;
  } & PosthogCampaignProps;
  signup_completed: {
    plan: string;
    authProvider?: string;
  } & PosthogCampaignProps;
  resume_uploaded: {
    fileType: string;
    fileSize: number;
    parseSuccess: boolean;
  };
  saved_search_created: {
    query: string;
    alertEnabled: boolean;
  } & PosthogCampaignProps;
  blog_article_viewed: {
    article: string;
  } & PosthogCampaignProps;
  blog_cta_clicked: {
    article: string;
    location: "middle" | "bottom";
  } & PosthogCampaignProps;
};

export type PosthogEventName = keyof PosthogEventProperties;

export function buildJobSearchEventProps(
  filters: JobFilters,
  listMeta: JobsApiResponse["meta"] | undefined,
): Omit<PosthogEventProperties["job_search"], keyof PosthogCampaignProps> {
  const query =
    (filters.roles?.length ? filters.roles.join(",") : undefined) ??
    (filters.role ? filters.role : undefined);
  const location =
    (filters.locations?.length ? filters.locations.join(",") : undefined) ??
    filters.location ??
    filters.country ??
    undefined;
  const remote =
    filters.isRemote === true ||
    filters.workType === "remote" ||
    Boolean(filters.workTypes?.includes("remote"));
  const pageRaw = listMeta?.page ?? filters.page;
  const page =
    typeof pageRaw === "number" && Number.isFinite(pageRaw) && pageRaw >= 1
      ? Math.floor(pageRaw)
      : 1;
  const sort = filters.sort === "salary_desc" ? "salary_desc" : "latest";
  const total = listMeta?.total ?? listMeta?.totalCount;
  const resultsCount =
    typeof total === "number" && Number.isFinite(total) ? Math.round(total) : undefined;
  return {
    query: query?.trim() || undefined,
    location: location?.trim() || undefined,
    remote,
    page,
    sort,
    resultsCount,
  };
}

export function captureEvent<N extends PosthogEventName>(
  name: N,
  properties?: PosthogEventProperties[N],
): void {
  if (typeof window === "undefined") return;
  if (!posthog.__loaded) return;
  posthog.capture(name, properties as Record<string, unknown>);
}

export function identifyPosthogUser(
  distinctId: string,
  properties?: Record<string, string | number | boolean | null | undefined>,
): void {
  if (typeof window === "undefined") return;
  if (!posthog.__loaded) return;
  posthog.identify(distinctId, properties);
}

export function resetPosthog(): void {
  if (typeof window === "undefined") return;
  if (!posthog.__loaded) return;
  posthog.reset();
}

/**
 * Runs `callback` after mount in a `queueMicrotask`, skipping stale runs after StrictMode
 * unmount/remount and fast dependency churn.
 */
export function usePosthogStableMicrotask(callback: () => void, deps: DependencyList): void {
  const genRef = useRef(0);
  useEffect(() => {
    const runId = ++genRef.current;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || runId !== genRef.current) return;
      callback();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller supplies full `deps`
  }, deps);
}
