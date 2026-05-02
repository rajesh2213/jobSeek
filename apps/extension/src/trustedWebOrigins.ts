declare const __TRUSTED_EXTENSION_WEB_ORIGINS__: readonly string[];

/**
 * Origins allowed to call chrome.runtime.sendMessage into this extension (externally_connectable).
 * Injected at build time so production bundles omit loopback literals (Chrome Web Store check).
 */
export const TRUSTED_EXTENSION_WEB_ORIGINS = __TRUSTED_EXTENSION_WEB_ORIGINS__;

export function isTrustedExtensionWebOrigin(origin: string): boolean {
  return (TRUSTED_EXTENSION_WEB_ORIGINS as readonly string[]).includes(origin);
}
