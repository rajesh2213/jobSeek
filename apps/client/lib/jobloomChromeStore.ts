/**
 * Chrome Web Store listing for the JobLoom extension. Set
 * `NEXT_PUBLIC_JOBLOOM_EXTENSION_ID` on Vercel (etc.) so install links resolve
 * to the live listing instead of a generic search.
 */
const EXTENSION_ID = process.env.NEXT_PUBLIC_JOBLOOM_EXTENSION_ID?.trim();
const STORE_SEARCH =
  "https://chromewebstore.google.com/search/JobLoom%20Smart%20Apply";

export function jobloomChromeWebStoreUrl(): string {
  if (!EXTENSION_ID) return STORE_SEARCH;
  return `https://chromewebstore.google.com/detail/jobloom-smart-apply/${EXTENSION_ID}`;
}
