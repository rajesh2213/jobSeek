/**
 * Central allowlist for server paths proxied from the service worker. Any other path is rejected
 * to limit abuse if a message handler is ever misused. Keep in sync with `api.ts` callers.
 */
export const API_PATHS = {
  applyProfile: "/account/apply-profile",
  smartApplyStatus: "/account/smart-apply/status",
  smartApplyBatchAnswer: "/account/smart-apply/batch-answer",
  smartApplyEvents: "/account/smart-apply/events",
  resumeDownload: "/account/resume/download",
  applications: "/applications",
} as const;

const ALLOWED = new Set<string>(Object.values(API_PATHS));

export function isAllowedApiPath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0 || path.length > 800) {
    return false;
  }
  if (!path.startsWith("/") || path.includes("..") || /[\0\r\n]/.test(path)) {
    return false;
  }
  if (path.includes("://") || path.includes("//") || path.startsWith("//")) {
    return false;
  }
  return ALLOWED.has(path);
}
