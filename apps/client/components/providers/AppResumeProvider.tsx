"use client";

import type { ReactNode } from "react";
import { ResumeProvider } from "../../lib/resumeContext";

export function AppResumeProvider({ children }: { children: ReactNode }) {
  return <ResumeProvider>{children}</ResumeProvider>;
}
