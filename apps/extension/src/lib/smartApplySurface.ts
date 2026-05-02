import { isLikelyAtsPage } from "./atsDetection";
import { tabMatchesManifestHostPermissions } from "./chromeMatchPattern";

/**
 * Smart Apply UI should appear on tabs matching manifest host grants **and** on URLs that look
 * like ATS/embed flows (e.g. Greenhouse query params on employer domains) even before manifest grows.
 */
export function isSmartApplyEligibleSurface(tabUrl: string): boolean {
  return tabMatchesManifestHostPermissions(tabUrl) || isLikelyAtsPage(tabUrl);
}
