import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher(["/account(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    // Prefer app-hosted `/sign-in` (embedded Clerk UI on localhost) over Clerk’s accounts.dev page,
    // which can spin forever when session refresh fails (clock skew or mismatched API keys).
    const signInUrl = new URL("/sign-in", req.url).href;
    await auth.protect(undefined, { unauthenticatedUrl: signInUrl });
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
