"use client";

import { createPortal } from "react-dom";
import { useEffect, useState, type ReactNode } from "react";

/** Renders children into document.body (avoids overflow/stacking clipping from card ancestors). */
export function ResumeBodyPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted || typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
