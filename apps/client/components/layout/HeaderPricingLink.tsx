"use client";

import Link from "next/link";
import { trackUpgradePromptClick } from "../../lib/analytics/upgradeFunnel";
import { cn } from "../../lib/cn";
import { useAccountPlan } from "../../lib/useAccountPlan";

type Props = {
  className?: string;
  surface: "header_nav" | "mobile_menu";
};

export function HeaderPricingLink({ className, surface }: Props) {
  const { isPro, isLoaded: planLoaded, pendingUpgrade } = useAccountPlan();
  const showPricing = !(planLoaded && (isPro || pendingUpgrade));

  if (!showPricing) return null;

  return (
    <Link
      href="/pricing"
      prefetch={false}
      onClick={() =>
        trackUpgradePromptClick({
          trigger: "header_nav",
          surface,
          cta_type: "nav_link",
        })
      }
      className={cn(
        "text-sm font-semibold text-ink/60 no-underline transition-colors hover:text-brand",
        className,
      )}
    >
      Pricing
    </Link>
  );
}
