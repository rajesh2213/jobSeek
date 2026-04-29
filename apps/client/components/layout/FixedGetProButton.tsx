"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { cn } from "../../lib/cn";
import { GET_PRO_BUTTON_ID } from "../../lib/headerWorkflowGlow";
import { useAccountPlan } from "../../lib/useAccountPlan";
import { WorkflowEndpointGlow } from "./WorkflowEndpointGlow";

const fixedFrame: CSSProperties = {
  position: "fixed",
  top: 10,
  right: 76,
  left: "auto",
  bottom: "auto",
};

export function FixedGetProButton() {
  const { isSignedIn } = useAuth();
  const { isPro, isLoaded: planLoaded, pendingUpgrade } = useAccountPlan();

  if (isSignedIn && planLoaded && (isPro || pendingUpgrade)) {
    return null;
  }

  return (
    <div style={fixedFrame} className="relative z-[100]">
      <WorkflowEndpointGlow>
        {(glow) => (
          <Link
            id={GET_PRO_BUTTON_ID}
            href="/pricing"
            prefetch={false}
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
        )}
      </WorkflowEndpointGlow>
    </div>
  );
}
