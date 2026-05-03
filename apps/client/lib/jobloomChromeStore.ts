/**
 * Chrome Web Store listing for the JobLoom extension.
 * Extension ID resolution lives in `jobloomExtensionId.ts`.
 */
import { resolveJobloomExtensionId } from "./jobloomExtensionId";

const STORE_SLUG = "jobloom-smart-apply-assis";

export function jobloomChromeWebStoreUrl(): string {
  return `https://chromewebstore.google.com/detail/${STORE_SLUG}/${resolveJobloomExtensionId()}`;
}
