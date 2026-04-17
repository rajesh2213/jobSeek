import type { ReactNode } from "react";
import { FixedAccountAvatar } from "../../components/layout/FixedAccountAvatar";
import { FixedGetProButton } from "../../components/layout/FixedGetProButton";
import { HeaderWorkflow } from "../../components/layout/HeaderWorkflow";
import { SiteHeader } from "../../components/layout/SiteHeader";
import { SiteSideRail } from "../../components/layout/SiteSideRail";
import { PageTransition } from "../../components/layout/PageTransition";
import { AppResumeProvider } from "../../components/providers/AppResumeProvider";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppResumeProvider>
      <SiteHeader />
      <HeaderWorkflow />
      <SiteSideRail />
      <FixedGetProButton />
      <FixedAccountAvatar />
      <div className="relative pb-20 lg:pl-[172px]">
        <PageTransition>{children}</PageTransition>
      </div>
    </AppResumeProvider>
  );
}
