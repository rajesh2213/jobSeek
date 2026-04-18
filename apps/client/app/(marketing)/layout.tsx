import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LegalFooter } from "../../components/layout/LegalFooter";
import { MarketingHeader } from "../../components/layout/MarketingHeader";
import { PageTransition } from "../../components/layout/PageTransition";
import { SiteSideRail } from "../../components/layout/SiteSideRail";

export const metadata: Metadata = {
  title: "JobSeek — aggregate jobs, apply early, track applications",
  description:
    "Discover open roles from career sites and boards in one place. Filter by skill, location, and remote—resume-aware matching and fast apply flows.",
  openGraph: {
    title: "JobSeek — aggregate jobs, apply early",
    description:
      "Discover open roles from career sites and boards in one place.",
  },
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <MarketingHeader />
      <SiteSideRail />
      <div className="relative flex min-h-screen flex-col lg:pl-[112px]">
        <PageTransition>{children}</PageTransition>
        <LegalFooter />
      </div>
    </>
  );
}
