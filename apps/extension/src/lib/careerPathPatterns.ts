import { matchesChromeMatchPattern } from "./chromeMatchPattern";

/**
 * Career URL shapes on arbitrary employer domains — too broad for default Web Store host_permissions.
 * Offered via optional_host_permissions + scripting.registerContentScripts after explicit user consent.
 */
export const OPTIONAL_GENERIC_CAREER_ORIGINS = [
  "https://*/apply/*",
  "https://*/careers/*",
  "https://*/jobs/*",
  "https://*/join-us/*",
] as const;

export function matchesOptionalGenericCareerPath(tabUrl: string): boolean {
  return OPTIONAL_GENERIC_CAREER_ORIGINS.some((p) => matchesChromeMatchPattern(tabUrl, p));
}
