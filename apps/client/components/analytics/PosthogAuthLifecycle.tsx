"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect, useRef } from "react";
import { useAccountPlan } from "../../lib/accountPlanContext";
import {
  captureEvent,
  identifyPosthogUser,
  withPosthogAttribution,
} from "../../lib/posthog";

function deriveAuthProviderLabel(
  user: NonNullable<ReturnType<typeof useUser>["user"]>,
): string | undefined {
  const ext = user.externalAccounts?.[0]?.provider;
  if (ext) return ext;
  if (user.passwordEnabled) return "password";
  return undefined;
}

const SIGNUP_FRESH_MS = 5 * 60 * 1000;

/**
 * Identifies signed-in users in PostHog; emits `signup_completed` once per user id (sessionStorage),
 * then re-identifies with plan/email as required by product analytics.
 */
export function PosthogAuthLifecycle() {
  const { user, isSignedIn, isLoaded } = useUser();
  const { plan, isLoaded: planLoaded } = useAccountPlan();
  const lastIdentifiedRef = useRef<string | null>(null);
  const lastPlanRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !planLoaded) return;

    if (!isSignedIn || !user) {
      lastIdentifiedRef.current = null;
      lastPlanRef.current = null;
      return;
    }

    const uid = user.id;
    const createdMs = user.createdAt ? new Date(user.createdAt).getTime() : NaN;
    const isFreshAccount =
      Number.isFinite(createdMs) && Date.now() - createdMs < SIGNUP_FRESH_MS;

    let alreadyLoggedSignup = false;
    try {
      alreadyLoggedSignup = sessionStorage.getItem(`posthog_signup_event_${uid}`) === "1";
    } catch {
      /* ignore */
    }

    const shouldEmitSignup = isFreshAccount && !alreadyLoggedSignup;

    if (shouldEmitSignup) {
      try {
        sessionStorage.setItem(`posthog_signup_event_${uid}`, "1");
      } catch {
        /* ignore */
      }

      captureEvent(
        "signup_completed",
        withPosthogAttribution({
          plan,
          authProvider: deriveAuthProviderLabel(user),
        }),
      );

      identifyPosthogUser(uid, {
        email: user.primaryEmailAddress?.emailAddress ?? undefined,
        plan,
      });
      lastIdentifiedRef.current = uid;
      lastPlanRef.current = plan;
      return;
    }

    if (lastIdentifiedRef.current !== uid) {
      lastIdentifiedRef.current = uid;
      lastPlanRef.current = plan;
      identifyPosthogUser(uid, {
        email: user.primaryEmailAddress?.emailAddress ?? undefined,
        plan,
      });
      return;
    }

    if (lastPlanRef.current !== plan) {
      lastPlanRef.current = plan;
      identifyPosthogUser(uid, {
        email: user.primaryEmailAddress?.emailAddress ?? undefined,
        plan,
      });
    }
  }, [isLoaded, planLoaded, isSignedIn, user, plan]);

  return null;
}
