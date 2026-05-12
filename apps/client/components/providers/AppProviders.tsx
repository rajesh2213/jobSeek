"use client";

import type { ReactNode } from "react";
import { MetaAnalyticsProvider } from "../../lib/analytics/provider";
import { AccountPlanProvider } from "../../lib/accountPlanContext";
import { ApplicationsProvider } from "../../lib/applicationsContext";
import { PosthogAuthLifecycle } from "../analytics/PosthogAuthLifecycle";
import { ToastProvider } from "../ui/Toast";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <MetaAnalyticsProvider>
      <ToastProvider>
        <AccountPlanProvider>
          <PosthogAuthLifecycle />
          <ApplicationsProvider>{children}</ApplicationsProvider>
        </AccountPlanProvider>
      </ToastProvider>
    </MetaAnalyticsProvider>
  );
}
