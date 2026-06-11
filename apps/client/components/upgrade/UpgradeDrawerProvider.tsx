"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { UpgradeTrigger } from "../../lib/analytics/upgradeFunnel";
import { UpgradeDrawer, type UpgradeDrawerContext } from "./UpgradeDrawer";

type OpenParams = {
  trigger: UpgradeTrigger;
  context?: UpgradeDrawerContext;
};

type UpgradeDrawerContextValue = {
  openUpgradeDrawer: (params: OpenParams) => void;
  closeUpgradeDrawer: () => void;
};

const Ctx = createContext<UpgradeDrawerContextValue | null>(null);

export function UpgradeDrawerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    open: boolean;
    trigger: UpgradeTrigger;
    context?: UpgradeDrawerContext;
  }>({ open: false, trigger: "unknown" });

  const openUpgradeDrawer = useCallback((params: OpenParams) => {
    setState({
      open: true,
      trigger: params.trigger,
      context: params.context,
    });
  }, []);

  const closeUpgradeDrawer = useCallback(() => {
    setState((s) => ({ ...s, open: false }));
  }, []);

  const value = useMemo(
    () => ({ openUpgradeDrawer, closeUpgradeDrawer }),
    [openUpgradeDrawer, closeUpgradeDrawer],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <UpgradeDrawer
        open={state.open}
        trigger={state.trigger}
        context={state.context}
        onClose={closeUpgradeDrawer}
      />
    </Ctx.Provider>
  );
}

export function useUpgradeDrawer(): UpgradeDrawerContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useUpgradeDrawer must be used within UpgradeDrawerProvider");
  }
  return ctx;
}
