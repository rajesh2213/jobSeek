import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher(["/account(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    // Prefer app-hosted `/sign-in` (embedded Clerk UI on localhost) over Clerk's accounts.dev page,
    // which can spin forever when session refresh fails (clock skew or mismatched API keys).
    const signInUrl = new URL("/sign-in", req.url).href;
    await auth.protect(undefined, { unauthenticatedUrl: signInUrl });
  }
});

/**
 * PRODUCTION-INTENT: Middleware scope is intentionally narrow for crawler scalability.
 *
 * Clerk session resolution runs on every matched request — even when `auth.protect()` is not
 * called.  For high-volume crawler/public traffic (company pages, sitemap, marketing pages,
 * robots.txt), this overhead is pure waste because those routes never call `auth()` server-side.
 *
 * Only routes that actually call `auth()` during SSR or need `auth.protect()` are listed below.
 * All excluded routes still work correctly: client-side Clerk hooks (`useAuth`, `useUser`)
 * function via `ClerkProvider` regardless of middleware.
 *
 * If a new route is added that calls `auth()` on the server, add it here or `auth()` will
 * return `{ userId: null }`.
 *
 * Excluded (no server-side auth): /, /about, /privacy, /terms, /support, /billing,
 *   /companies, /company/*, /job/*, /jobs, /jobs/* (SEO ISR), /jobs/browse, /pricing,
 *   /sitemap.xml, /robots.txt, /sign-in, /sign-up, /applications, /saved-searches,
 *   /smart-apply, /features/* (public SEO landing pages), /api/companies,
 *   /api/seo/aggregations, static assets.
 */
export const config = {
  matcher: [
    "/account/:path*",
    "/api/jobs",
    "/api/user/me",
  ],
};
