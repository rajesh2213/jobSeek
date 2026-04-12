"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { cn } from "../../lib/cn";
import { GET_PRO_GLOW_EVENT, GET_PRO_GLOW_MS } from "../../lib/headerWorkflowGlow";

/**
 * Radial glow + ring triggered by `GET_PRO_GLOW_EVENT` (header workflow path completion).
 * Pass `children` as a function to style the target when `glow` is true (e.g. Get Pro / account).
 */
export function WorkflowEndpointGlow({
  children,
  className,
}: {
  children: ReactNode | ((glow: boolean) => ReactNode);
  className?: string;
}) {
  const [glow, setGlow] = useState(false);

  useEffect(() => {
    let offTimer: ReturnType<typeof setTimeout> | undefined;
    const onGlow = (e: Event) => {
      const ce = e as CustomEvent<{ ms?: number }>;
      const ms = typeof ce.detail?.ms === "number" ? ce.detail.ms : GET_PRO_GLOW_MS;
      setGlow(true);
      if (offTimer) clearTimeout(offTimer);
      offTimer = setTimeout(() => setGlow(false), ms);
    };
    window.addEventListener(GET_PRO_GLOW_EVENT, onGlow);
    return () => {
      window.removeEventListener(GET_PRO_GLOW_EVENT, onGlow);
      if (offTimer) clearTimeout(offTimer);
    };
  }, []);

  const inner = typeof children === "function" ? children(glow) : children;

  return (
    <div className={cn("relative", className)}>
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute -inset-3 z-0 rounded-[999px] transition-[opacity,transform] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]",
          "bg-[radial-gradient(ellipse_85%_70%_at_50%_40%,rgba(255,255,255,0.55)_0%,rgba(255,182,160,0.35)_38%,rgba(52,211,153,0.12)_62%,transparent_78%)]",
          "blur-xl",
          glow ? "opacity-100 scale-100" : "opacity-0 scale-[0.92]",
        )}
      />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute -inset-[5px] z-[1] rounded-[999px] border-[1.5px] border-white/50 bg-transparent",
          "transition-[opacity,box-shadow,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
          glow
            ? "opacity-100 shadow-[0_0_10px_2px_rgba(255,255,255,0.35),0_0_22px_5px_rgba(255,165,135,0.45),0_0_36px_10px_rgba(52,211,153,0.18)]"
            : "opacity-0 shadow-none",
        )}
      />
      <div className="relative z-[2]">{inner}</div>
    </div>
  );
}
