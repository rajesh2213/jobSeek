import posthog from "posthog-js";

/**
 * Typed product events. Call `captureEvent` from client components or client-side handlers only.
 * Server / pre-init: no-op.
 */
export type PosthogEventProperties = {
  job_viewed: { job_id: string; slug?: string; title?: string; company?: string };
  job_search: { query?: string; location?: string; filters_key?: string };
  job_apply_clicked: { job_id: string; destination?: string };
  signup_started: { source?: string };
  signup_completed: { source?: string };
  resume_uploaded: { mime_type?: string; source?: string };
  saved_search_created: { saved_search_id?: string; query_summary?: string };
};

export type PosthogEventName = keyof PosthogEventProperties;

export function captureEvent<N extends PosthogEventName>(
  name: N,
  properties?: PosthogEventProperties[N],
): void {
  if (typeof window === "undefined") return;
  if (!posthog.__loaded) return;
  posthog.capture(name, properties as Record<string, unknown>);
}

/** Call after sign-in when PostHog is initialized (e.g. from a client component under `ClerkProvider`). */
export function identifyPosthogUser(
  distinctId: string,
  properties?: Record<string, string | number | boolean | null | undefined>,
): void {
  if (typeof window === "undefined") return;
  if (!posthog.__loaded) return;
  posthog.identify(distinctId, properties);
}

/** Call on sign-out to unlink the browser session from the previous user. */
export function resetPosthog(): void {
  if (typeof window === "undefined") return;
  if (!posthog.__loaded) return;
  posthog.reset();
}
