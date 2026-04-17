"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useState } from "react";
import { fetchAccountSummary, type AccountSummary } from "./api";
import { isPro as planIsPro } from "./planLimits";

export function useAccountPlan(): {
  plan: "free" | "pro" | "pro_plus";
  isPro: boolean;
  isLoaded: boolean;
  refresh: () => Promise<void>;
} {
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

  const plan = summary?.plan ?? "free";
  const isPro = planIsPro(plan);

  return {
    plan,
    isPro,
    isLoaded: authLoaded && loaded,
    refresh,
  };
}
