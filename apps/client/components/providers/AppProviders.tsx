"use client";

import type { ReactNode } from "react";
import { ToastProvider } from "../ui/Toast";
import { ApplicationsProvider } from "../../lib/applicationsContext";
import { ResumeProvider } from "../../lib/resumeContext";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ApplicationsProvider>
        <ResumeProvider>{children}</ResumeProvider>
      </ApplicationsProvider>
    </ToastProvider>
  );
}
