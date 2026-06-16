import { isTrustedExtensionWebOrigin } from "../trustedWebOrigins";

const SET_AUTH = "jobloom-extension-set-auth";
const CLEAR_AUTH = "jobloom-extension-clear-auth";

const EXT_AUTH_TOKEN_MAX_CHARS = 16_384;

function looseJwtShape(token: string): boolean {
  const parts = token.split(".");
  return parts.length >= 3 && parts.every((p) => p.length > 0);
}

function storeAuthToken(token: string | null, sendResponse?: (r: { ok: boolean; error?: string }) => void) {
  if (!token) {
    void chrome.storage.local.remove(["authToken"], () => {
      sendResponse?.({ ok: true });
    });
    return;
  }
  const trimmed = token.trim();
  if (!trimmed) {
    void chrome.storage.local.remove(["authToken"], () => {
      sendResponse?.({ ok: true });
    });
    return;
  }
  if (trimmed.length > EXT_AUTH_TOKEN_MAX_CHARS || !looseJwtShape(trimmed)) {
    sendResponse?.({ ok: false, error: "Invalid token" });
    return;
  }
  void chrome.storage.local.set({ authToken: trimmed }, () => {
    sendResponse?.({ ok: true });
  });
}

/** Accept Clerk JWT from the JobLoom site via same-origin postMessage (installed extension only). */
export function startContentAuthBridge(): void {
  if (!isTrustedExtensionWebOrigin(window.location.origin)) return;

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (!isTrustedExtensionWebOrigin(event.origin)) return;

    const data = event.data as { type?: unknown; token?: unknown } | null;
    if (!data || typeof data !== "object") return;

    if (data.type === SET_AUTH) {
      if (typeof data.token !== "string") return;
      storeAuthToken(data.token);
      return;
    }

    if (data.type === CLEAR_AUTH) {
      storeAuthToken(null);
    }
  });
}
