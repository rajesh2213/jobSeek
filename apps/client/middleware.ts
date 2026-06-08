import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { resolveJobDetailCanonicalRedirect } from "./lib/jobCanonicalRedirect";
import { resolveJobsListingCanonicalRedirect } from "./lib/jobsListingCanonicalRedirect";

const isProtectedRoute = createRouteMatcher(["/account(.*)"]);
const isJobsListingRoute = createRouteMatcher(["/jobs", "/jobs/(.*)"]);
const isJobDetailRoute = createRouteMatcher(["/job/:path*"]);

const clerkAuthMiddleware = clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    const signInUrl = new URL("/sign-in", req.url).href;
    await auth.protect(undefined, { unauthenticatedUrl: signInUrl });
  }
});

/**
 * Avoid invoking Clerk session resolution for high-volume public jobs listing traffic.
 * `/jobs` canonicalization is handled here in plain middleware, while auth-aware routes
 * continue through Clerk middleware below.
 */
export default async function middleware(req: NextRequest, event: NextFetchEvent) {
  if (isJobsListingRoute(req)) {
    const destination = resolveJobsListingCanonicalRedirect(req);
    if (destination) return NextResponse.redirect(destination, 308);
    return NextResponse.next();
  }
  if (isJobDetailRoute(req)) {
    const destination = resolveJobDetailCanonicalRedirect(req);
    if (destination) return NextResponse.redirect(destination, 308);
    return NextResponse.next();
  }
  return clerkAuthMiddleware(req, event);
}

/**
 * PRODUCTION-INTENT: Middleware scope is intentionally narrow for crawler scalability.
 *
 * `/jobs` and `/jobs/*` are matched only for canonical redirect (query stripping /
 * slug canonicalization) before ISR — then return without Clerk session work.
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
 *   /companies, /company/*,
 *   /jobs/browse, /pricing,
 *   /sitemap.xml, /sitemap-*.xml, /sitemap-jobs/*, /robots.txt, /sign-in, /sign-up,
 *   /applications, /saved-searches,
 *   /smart-apply, /features/* (public SEO landing pages), /api/companies,
 *   /api/seo/aggregations, static assets.
 */
export const config = {
  matcher: [
    "/jobs",
    "/jobs/:path*",
    "/job/:path*",
    "/account/:path*",
    "/api/jobs",
    "/api/jobs/:path*",
    "/api/user/me",
  ],
};
