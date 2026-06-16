/**
 * Published JobLoom Smart Apply Chrome extension ID. Used for Web Store URLs
 * and `chrome.runtime.sendMessage` auth sync from the site into the extension.
 *
 * `NEXT_PUBLIC_JOBLOOM_EXTENSION_ID` overrides (e.g. unpacked QA builds).
 */
export const JOBLOOM_PUBLISHED_EXTENSION_ID = "dalcjlikogmnhdgdglndhbllibmhfded";

export function resolveJobloomExtensionId(): string {
  return process.env.NEXT_PUBLIC_JOBLOOM_EXTENSION_ID?.trim() || JOBLOOM_PUBLISHED_EXTENSION_ID;
}
