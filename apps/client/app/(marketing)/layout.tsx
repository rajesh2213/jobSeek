import type { ReactNode } from "react";
import { MarketingHeader } from "../../components/layout/MarketingHeader";
import { SiteSideRail } from "../../components/layout/SiteSideRail";
import { PageTransition } from "../../components/layout/PageTransition";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <MarketingHeader />
      <SiteSideRail />
      <div className="relative lg:pl-[112px]">
        <PageTransition>{children}</PageTransition>
      </div>
    </>
  );
}
