import type { ReactNode } from "react";
import { FixedAccountAvatar } from "../../components/layout/FixedAccountAvatar";
import { FixedGetProButton } from "../../components/layout/FixedGetProButton";
import { HeaderWorkflow } from "../../components/layout/HeaderWorkflow";
import { LegalFooter } from "../../components/layout/LegalFooter";
import { PageTransition } from "../../components/layout/PageTransition";
import { SiteHeader } from "../../components/layout/SiteHeader";
import { SiteSideRailProvider } from "../../components/layout/SiteSideRail";
import { AppResumeProvider } from "../../components/providers/AppResumeProvider";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppResumeProvider>
      <SiteSideRailProvider>
        <SiteHeader />
        <HeaderWorkflow />
        <FixedGetProButton />
        <FixedAccountAvatar />
        <div className="relative flex min-h-screen flex-col pb-20 lg:px-[172px]">
          <PageTransition>{children}</PageTransition>
          <LegalFooter />
        </div>
      </SiteSideRailProvider>
    </AppResumeProvider>
  );
}
