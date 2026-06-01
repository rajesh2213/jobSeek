/**
 * Resolve Fastify API origin for fetches.
 *
 * Server (RSC, route handlers): prefer runtime `API_BASE_URL` so Vercel can point SSR
 * at production API without rebuilding when only server env is set.
 *
 * Browser: `NEXT_PUBLIC_API_BASE_URL` only (inlined at build).
 */
export function resolveApiBaseUrl(): string {
  const fallback = "http://localhost:3000";
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || fallback;
  }
  return (
    process.env.API_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
    fallback
  );
}
