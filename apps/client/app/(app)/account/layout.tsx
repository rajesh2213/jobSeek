import type { ReactNode } from "react";

/**
 * Stack account UI above the sticky header (z-[70] / z-[80]) so sidebar + Clerk profile
 * aren’t covered when scrolling; other routes keep default stacking.
 */
export default function AccountLayout({ children }: { children: ReactNode }) {
  return <div className="relative z-[90]">{children}</div>;
}
