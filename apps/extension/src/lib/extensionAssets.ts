/** Packaged logo for popup / content UI (copied to `dist/icons` by webpack). */
export function extensionLogoPrimUrl(): string {
  return chrome.runtime.getURL("icons/logo-prim.png");
}
