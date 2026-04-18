"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { cn } from "../../lib/cn";
import { motionEase } from "../../lib/motion";

const NEAR_TOP_PX = 72;

function getDocumentScrollY(): number {
  if (typeof window === "undefined") return 0;
  return (
    window.scrollY ??
    window.pageYOffset ??
    document.scrollingElement?.scrollTop ??
    document.documentElement.scrollTop ??
    document.body.scrollTop ??
    0
  );
}

/**
 * Show promo chrome only when the document is scrolled near the top.
 * Uses scroll position only (not scroll direction), so scrolling up mid-page
 * cannot reveal the chrome until the user actually reaches the top zone.
 */
export function useScrollRevealPromos(): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const sync = () => {
      setVisible(getDocumentScrollY() < NEAR_TOP_PX);
    };
    sync();
    window.addEventListener("scroll", sync, { passive: true, capture: true });
    window.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("scroll", sync, { capture: true });
      window.removeEventListener("resize", sync);
    };
  }, []);

  return visible;
}

/** Horizontal shrink + height collapse; use for scroll-linked promo rows. */
export function ScrollCollapseChrome({
  show,
  children,
  className,
}: {
  show: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(className)}>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          show ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <motion.div
            initial={false}
            animate={{
              scaleX: show ? 1 : 0,
              opacity: show ? 1 : 0,
            }}
            transition={{ duration: 0.35, ease: motionEase }}
            style={{ transformOrigin: "50% 50%" }}
            className={cn("will-change-transform", !show && "pointer-events-none")}
            aria-hidden={!show}
          >
            {children}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
