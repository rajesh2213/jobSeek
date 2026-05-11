"use client";

import { useAuth } from "@clerk/nextjs";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  fetchAccountSummary,
  fetchBillingStatus,
  type AccountSummary,
  type ResumeMatchAiQuotaState,
} from "./api";
import { isBillingSubscriptionEntitled } from "./billingEntitlement";
import { isPro as planIsPro } from "./planLimits";

export const PENDING_UPGRADE_STORAGE_KEY = "jobloom.pendingUpgrade";

export interface AccountPlanContextValue {
  plan: "free" | "pro";
  isPro: boolean;
  isLoaded: boolean;
  pendingUpgrade: boolean;
  /** Free-tier AI resume match quota from `/account/summary`; null when Pro or unavailable. */
  resumeMatchAi: ResumeMatchAiQuotaState | null;
  refresh: () => Promise<AccountSummary | null>;
  markPendingUpgrade: () => void;
  clearPendingUpgrade: () => void;
}

const AccountPlanContext = createContext<AccountPlanContextValue | null>(null);

export function AccountPlanProvider({ children }: { children: ReactNode }) {
  const { getToken, isLoaded: authLoaded, isSignedIn } = useAuth();
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pendingUpgrade, setPendingUpgrade] = useState(false);

  const refresh = useCallback(async () => {
    if (!isSignedIn) {
      setSummary(null);
      setLoaded(true);
      return null;
    }
    const token = await getToken();
    if (!token) {
      setSummary(null);
      setLoaded(true);
      return null;
    }
    const [s, billing] = await Promise.all([fetchAccountSummary(token), fetchBillingStatus(token)]);
    const entitledFromBilling = isBillingSubscriptionEntitled(billing?.subscription ?? null);
    const normalizedSummary = s
      ? { ...s, plan: entitledFromBilling ? "pro" : s.plan }
      : s;
    setSummary(normalizedSummary);
    setLoaded(true);
    const subStatus = billing?.subscription?.status;
    const checkoutTerminal =
      normalizedSummary?.plan === "pro" ||
      subStatus === "active" ||
      subStatus === "past_due" ||
      subStatus === "canceled";
    if (checkoutTerminal) {
      setPendingUpgrade(false);
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(PENDING_UPGRADE_STORAGE_KEY);
      }
    }
    return normalizedSummary;
  }, [getToken, isSignedIn]);

  const markPendingUpgrade = useCallback(() => {
    setPendingUpgrade(true);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PENDING_UPGRADE_STORAGE_KEY, "1");
    }
  }, []);

  const clearPendingUpgrade = useCallback(() => {
    setPendingUpgrade(false);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(PENDING_UPGRADE_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!authLoaded) return;
    if (!isSignedIn) {
      clearPendingUpgrade();
      return;
    }
    if (typeof window === "undefined") return;
    const pending = window.localStorage.getItem(PENDING_UPGRADE_STORAGE_KEY) === "1";
    setPendingUpgrade(pending);
  }, [authLoaded, clearPendingUpgrade, isSignedIn]);

  useEffect(() => {
    if (!authLoaded || !isSignedIn || !pendingUpgrade) return;
    if (summary?.plan === "pro") return;

    let cancelled = false;
    const startedAt = Date.now();

    const poll = async () => {
      const latest = await refresh();
      if (cancelled) return;
      const token = await getToken();
      const billing = token ? await fetchBillingStatus(token) : null;
      const subStatus = billing?.subscription?.status;
      if (
        latest?.plan === "pro" ||
        subStatus === "active" ||
        subStatus === "past_due" ||
        subStatus === "canceled"
      ) {
        return;
      }
      if (Date.now() - startedAt >= 60_000) {
        clearPendingUpgrade();
        return;
      }
      setTimeout(poll, 2500);
    };

    void poll();

    return () => {
      cancelled = true;
    };
  }, [authLoaded, clearPendingUpgrade, getToken, isSignedIn, pendingUpgrade, refresh, summary?.plan]);

  const value = useMemo<AccountPlanContextValue>(() => {
    const plan = summary?.plan ?? "free";
    const pro = planIsPro(plan);
    return {
      plan,
      isPro: pro,
      isLoaded: authLoaded && loaded,
      pendingUpgrade,
      resumeMatchAi: pro ? null : (summary?.resumeMatchAi ?? null),
      refresh,
      markPendingUpgrade,
      clearPendingUpgrade,
    };
  }, [
    authLoaded,
    loaded,
    pendingUpgrade,
    refresh,
    summary,
    markPendingUpgrade,
    clearPendingUpgrade,
  ]);

  return (
    <AccountPlanContext.Provider value={value}>{children}</AccountPlanContext.Provider>
  );
}

export function useAccountPlan(): AccountPlanContextValue {
  const ctx = useContext(AccountPlanContext);
  if (!ctx) {
    throw new Error("useAccountPlan must be used within AccountPlanProvider");
  }
  return ctx;
}
