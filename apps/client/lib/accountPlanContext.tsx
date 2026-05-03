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
import { fetchAccountSummary, type AccountSummary } from "./api";
import { isPro as planIsPro } from "./planLimits";

export const PENDING_UPGRADE_STORAGE_KEY = "jobloom.pendingUpgrade";

export interface AccountPlanContextValue {
  plan: "free" | "pro";
  isPro: boolean;
  isLoaded: boolean;
  pendingUpgrade: boolean;
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
    const s = await fetchAccountSummary(token);
    setSummary(s);
    setLoaded(true);
    if (s?.plan === "pro") {
      setPendingUpgrade(false);
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(PENDING_UPGRADE_STORAGE_KEY);
      }
    }
    return s;
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
      if (latest?.plan === "pro") return;
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
  }, [authLoaded, clearPendingUpgrade, isSignedIn, pendingUpgrade, refresh, summary?.plan]);

  const value = useMemo<AccountPlanContextValue>(() => {
    const plan = summary?.plan ?? "free";
    return {
      plan,
      isPro: planIsPro(plan),
      isLoaded: authLoaded && loaded,
      pendingUpgrade,
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
