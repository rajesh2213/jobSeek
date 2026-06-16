/** Same-origin postMessage bridge when external `chrome.runtime.sendMessage` is unavailable or targets the wrong ID. */
export const JOBLOOM_EXTENSION_SET_AUTH = "jobloom-extension-set-auth";
export const JOBLOOM_EXTENSION_CLEAR_AUTH = "jobloom-extension-clear-auth";

const JOBLOOM_WEB_ORIGINS = new Set(["https://jobloom.tech", "https://www.jobloom.tech"]);

export function isJobloomWebOrigin(origin: string): boolean {
  return JOBLOOM_WEB_ORIGINS.has(origin);
}

export function postAuthTokenToInstalledExtension(token: string): void {
  if (typeof window === "undefined" || !isJobloomWebOrigin(window.location.origin)) return;
  window.postMessage({ type: JOBLOOM_EXTENSION_SET_AUTH, token }, window.location.origin);
}

export function postClearAuthToInstalledExtension(): void {
  if (typeof window === "undefined" || !isJobloomWebOrigin(window.location.origin)) return;
  window.postMessage({ type: JOBLOOM_EXTENSION_CLEAR_AUTH }, window.location.origin);
}
