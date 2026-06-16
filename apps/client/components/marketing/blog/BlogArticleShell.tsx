import type { ReactNode } from "react";
import { DESKTOP_RAIL_INSET_CLASS } from "../../layout/railInset";

export function BlogArticleShell({ children }: { children: ReactNode }) {
  return (
    <div className={`min-h-screen bg-canvas pb-24 pt-10 text-ink ${DESKTOP_RAIL_INSET_CLASS}`}>
      <div className="mx-auto w-[90%] max-w-readable px-4">{children}</div>
    </div>
  );
}
