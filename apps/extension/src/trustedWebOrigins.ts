/**
 * Origins allowed to call chrome.runtime.sendMessage into this extension (externally_connectable).
 * Keep in sync with matches in manifest.json.
 */
export const TRUSTED_EXTENSION_WEB_ORIGINS = [
  "https://jobloom.tech",
  "https://www.jobloom.tech",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
] as const;

export function isTrustedExtensionWebOrigin(origin: string): boolean {
  return (TRUSTED_EXTENSION_WEB_ORIGINS as readonly string[]).includes(origin);
}
