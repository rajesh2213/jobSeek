"use client";

import { useAuth, useClerk } from "@clerk/nextjs";
import { DodoPayments } from "dodopayments-checkout";
import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL } from "./api";
import {
  trackCheckoutStarted,
  type UpgradeSurface,
  type UpgradeTrigger,
} from "./analytics/upgradeFunnel";
import { useAccountPlan } from "./useAccountPlan";
import { storeCheckoutAttribution } from "./upgradeTriggers";

export type CheckoutKey = "pro_annual" | "pro_monthly";

export const PLAN_TYPE_BY_KEY: Record<CheckoutKey, "monthly" | "yearly"> = {
  pro_annual: "yearly",
  pro_monthly: "monthly",
};

const DODO_MODE: "test" | "live" =
  process.env.NEXT_PUBLIC_DODO_PAYMENTS_MODE === "live" ? "live" : "test";

export type UseProCheckoutOptions = {
  trigger?: UpgradeTrigger;
  surface?: UpgradeSurface;
};

export function useProCheckout(options: UseProCheckoutOptions = {}) {
  const { trigger = "unknown", surface } = options;
  const { getToken, isSignedIn } = useAuth();
  const { openSignIn } = useClerk();
  const { markPendingUpgrade, clearPendingUpgrade } = useAccountPlan();

  const ensureSignedInForCheckout = useCallback((): boolean => {
    if (isSignedIn) return true;
    if (typeof window === "undefined") return false;
    const returnUrl = `${window.location.pathname}${window.location.search}`;
    openSignIn({
      forceRedirectUrl: returnUrl.includes("/pricing") ? returnUrl : `/pricing?from=${trigger}`,
    });
    return false;
  }, [isSignedIn, openSignIn, trigger]);
  const [busyPayPal, setBusyPayPal] = useState<null | CheckoutKey>(null);
  const [busyDodo, setBusyDodo] = useState<null | CheckoutKey>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    DodoPayments.Initialize({
      mode: DODO_MODE,
      displayType: "overlay",
      onEvent: (event) => {
        if (event.event_type === "checkout.error") {
          console.error(event);
        }
      },
    });
    return () => {
      DodoPayments.Checkout.close();
    };
  }, []);

  const closeDodoCheckoutAndReset = useCallback(() => {
    try {
      DodoPayments.Checkout.close();
    } catch {
      /* ignore */
    }
    clearPendingUpgrade();
  }, [clearPendingUpgrade]);

  const startPayPalCheckout = useCallback(
    async (which: CheckoutKey) => {
      if (!ensureSignedInForCheckout()) return;
      setError(null);
      setBusyPayPal(which);
      try {
        const token = await getToken();
        if (!token) {
          openSignIn({
            forceRedirectUrl:
              typeof window !== "undefined"
                ? `${window.location.pathname}${window.location.search}`
                : "/pricing",
          });
          return;
        }
        const planType = PLAN_TYPE_BY_KEY[which];
        trackCheckoutStarted({
          trigger,
          plan_type: planType,
          provider: "paypal",
          surface,
        });
        storeCheckoutAttribution(trigger);
        const res = await fetch(`${API_BASE_URL}/billing/paypal/create-subscription`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ planType }),
        });
        const data = (await res.json().catch(() => ({}))) as { approvalUrl?: string; error?: string };
        if (!res.ok) {
          setError(data.error ?? "Could not start checkout. Try again.");
          return;
        }
        if (data.approvalUrl) {
          markPendingUpgrade();
          window.location.assign(data.approvalUrl);
          return;
        }
        setError("No approval URL returned.");
      } catch {
        setError("Network error. Check your connection and API URL.");
      } finally {
        setBusyPayPal(null);
      }
    },
    [ensureSignedInForCheckout, getToken, markPendingUpgrade, openSignIn, surface, trigger],
  );

  const startDodoCheckout = useCallback(
    async (which: CheckoutKey) => {
      if (!ensureSignedInForCheckout()) return;
      setError(null);
      setBusyDodo(which);
      try {
        const token = await getToken();
        if (!token) {
          openSignIn({
            forceRedirectUrl:
              typeof window !== "undefined"
                ? `${window.location.pathname}${window.location.search}`
                : "/pricing",
          });
          return;
        }
        const planType = PLAN_TYPE_BY_KEY[which];
        trackCheckoutStarted({
          trigger,
          plan_type: planType,
          provider: "dodo",
          surface,
        });
        storeCheckoutAttribution(trigger);
        const res = await fetch(`${API_BASE_URL}/billing/dodo/create-checkout`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ planType }),
        });
        const data = (await res.json().catch(() => ({}))) as { checkoutUrl?: string; error?: string };
        if (!res.ok) {
          setError(data.error ?? "Could not start checkout. Try again.");
          return;
        }
        if (data.checkoutUrl) {
          markPendingUpgrade();
          DodoPayments.Checkout.open({
            checkoutUrl: data.checkoutUrl,
          });
          return;
        }
        setError("No checkout URL returned.");
      } catch {
        setError("Network error. Check your connection and API URL.");
      } finally {
        setBusyDodo(null);
      }
    },
    [ensureSignedInForCheckout, getToken, markPendingUpgrade, openSignIn, surface, trigger],
  );

  return {
    busyPayPal,
    busyDodo,
    error,
    setError,
    startPayPalCheckout,
    startDodoCheckout,
    closeDodoCheckoutAndReset,
  };
}
