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

export interface AccountPlanContextValue {
  plan: "free" | "pro";
  isPro: boolean;
  isLoaded: boolean;
  refresh: () => Promise<void>;
}

const AccountPlanContext = createContext<AccountPlanContextValue | null>(null);

export function AccountPlanProvider({ children }: { children: ReactNode }) {
  const { getToken, isLoaded: authLoaded, isSignedIn } = useAuth();
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!isSignedIn) {
      setSummary(null);
      setLoaded(true);
      return;
    }
    const token = await getToken();
    if (!token) {
      setSummary(null);
      setLoaded(true);
      return;
    }
    const s = await fetchAccountSummary(token);
    setSummary(s);
    setLoaded(true);
  }, [getToken, isSignedIn]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AccountPlanContextValue>(() => {
    const plan = summary?.plan ?? "free";
    return {
      plan,
      isPro: planIsPro(plan),
      isLoaded: authLoaded && loaded,
      refresh,
    };
  }, [authLoaded, loaded, refresh, summary]);

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
