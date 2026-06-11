import type { ReactNode } from "react";
import { FixedAccountAvatar } from "../../components/layout/FixedAccountAvatar";
import { HeaderWorkflow } from "../../components/layout/HeaderWorkflow";
import { LegalFooter } from "../../components/layout/LegalFooter";
import { PageTransition } from "../../components/layout/PageTransition";
import { RailMainSurface } from "../../components/layout/RailMainSurface";
import { SiteHeader } from "../../components/layout/SiteHeader";
import { DESKTOP_RAIL_INSET_CLASS } from "../../components/layout/railInset";
import { SiteSideRailProvider } from "../../components/layout/SiteSideRail";
import { AppResumeProvider } from "../../components/providers/AppResumeProvider";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppResumeProvider>
      <SiteSideRailProvider>
        <SiteHeader />
        <HeaderWorkflow />
        <FixedAccountAvatar />
        {/* `overflow-x-hidden` breaks `position:sticky` for descendants; `clip` trims overflow without that issue */}
        <div className="relative flex min-h-screen flex-col overflow-x-clip pb-20">
          <RailMainSurface className="flex-1">
            <PageTransition>
              <div className={`flex min-h-0 flex-1 flex-col ${DESKTOP_RAIL_INSET_CLASS}`}>
                {children}
              </div>
            </PageTransition>
          </RailMainSurface>
          <LegalFooter />
        </div>
      </SiteSideRailProvider>
    </AppResumeProvider>
  );
}
