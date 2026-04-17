"use client";

import type { ReactNode } from "react";
import { AccountPlanProvider } from "../../lib/accountPlanContext";
import { ApplicationsProvider } from "../../lib/applicationsContext";
import { ToastProvider } from "../ui/Toast";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AccountPlanProvider>
        <ApplicationsProvider>{children}</ApplicationsProvider>
      </AccountPlanProvider>
    </ToastProvider>
  );
}
