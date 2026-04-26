/** Packaged logo for popup / content UI (copied to `dist/assets` by webpack). */
export function extensionLogoPrimUrl(): string {
  return chrome.runtime.getURL("assets/logo-prim.png");
}
