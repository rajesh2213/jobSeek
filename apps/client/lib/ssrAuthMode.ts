import { cookies } from "next/headers";

/** When not `0`, anonymous SSR uses public SEO loaders (no Clerk `auth()` / `headers()`). */
export function usePublicSeoLoaders(): boolean {
  return process.env.SSR_PUBLIC_SEO_LOADERS?.trim() !== "0";
}

/** When not `0`, company hub SSR includes first page of jobs for crawlers. */
export function ssrCompanyJobsEnabled(): boolean {
  return process.env.SSR_COMPANY_JOBS?.trim() !== "0";
}

/**
 * Lightweight session hint — avoids Clerk session resolution on anonymous crawlers.
 * Client-side Clerk hooks still work via `ClerkProvider`.
 */
export async function hasClerkSessionCookie(): Promise<boolean> {
  const cookieStore = await cookies();
  const session = cookieStore.get("__session");
  const clientUat = cookieStore.get("__client_uat");
  return Boolean(session?.value?.trim() || clientUat?.value?.trim());
}
