"use client";

import { useEffect, useRef } from "react";
import { syncExtensionAuthToken } from "./extensionAuthBridge";

const DEBOUNCE_MS = 750;

/**
 * Keeps Smart Apply extension storage in sync with the signed-in Clerk session
 * (initial + debounced refresh on tab focus / visibility).
 */
export type ExtensionAuthGetToken = (opts?: { skipCache?: boolean }) => Promise<string | null>;

export function useExtensionAuthSync(options: {
  enabled: boolean;
  getToken: ExtensionAuthGetToken;
}): void {
  const { enabled, getToken } = options;
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  useEffect(() => {
    if (!enabled) return;

    const sync = () =>
      void syncExtensionAuthToken(() => getTokenRef.current({ skipCache: true }));

    void sync();

    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void sync();
      }, DEBOUNCE_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") schedule();
    };

    window.addEventListener("focus", schedule);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("focus", schedule);
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);
}
