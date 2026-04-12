"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "../../lib/cn";
import { GET_PRO_GLOW_EVENT, GET_PRO_GLOW_MS } from "../../lib/headerWorkflowGlow";

const fixedFrame: CSSProperties = {
  position: "fixed",
  top: 10,
  right: 76,
  left: "auto",
  bottom: "auto",
};

export function FixedGetProButton() {
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

  return (
    <div style={fixedFrame} className="relative z-[100]">
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
      <Link
        id="get-pro-button"
        href="/pricing"
        className={cn(
          "relative z-[2] inline-flex h-11 items-center rounded-full bg-brand px-4 text-sm font-bold !text-white no-underline shadow-sm",
          "visited:!text-white hover:bg-brand-hover hover:!text-white active:!text-white",
          "transition-[box-shadow,transform,filter] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
          glow
            ? "scale-[1.02] shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_0_0_1px_rgba(255,255,255,0.14),0_2px_4px_rgba(0,0,0,0.08),0_8px_24px_rgba(232,83,58,0.35),0_16px_48px_rgba(0,0,0,0.12)] brightness-[1.06]"
            : "",
        )}
      >
        Get Pro
      </Link>
    </div>
  );
}
