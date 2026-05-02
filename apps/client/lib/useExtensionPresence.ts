"use client";

import { useEffect, useState } from "react";

const EVENT_NAME = "jobseek-extension-ready";

export function useExtensionPresence(pollMs = 1500): boolean {
  const [present, setPresent] = useState(
    () => typeof window !== "undefined" && window.__JOBSEEK_EXTENSION__ === true,
  );

  useEffect(() => {
    const check = () => {
      if (typeof window === "undefined") return;
      if (window.__JOBSEEK_EXTENSION__) setPresent(true);
    };

    check();
    const id = window.setInterval(check, pollMs);
    const onReady = () => setPresent(true);
    window.addEventListener(EVENT_NAME, onReady);

    return () => {
      window.clearInterval(id);
      window.removeEventListener(EVENT_NAME, onReady);
    };
  }, [pollMs]);

  return present;
}
