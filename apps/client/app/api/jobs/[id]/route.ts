import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { resolveApiBaseUrl } from "../../../../lib/apiBaseUrl";
import { hasClerkSessionCookie } from "../../../../lib/ssrAuthMode";

const API_BASE = resolveApiBaseUrl();

export const dynamic = "force-dynamic";

/**
 * Server/browser proxy for `GET /jobs/:id`.
 *
 * Aligns job detail SSR with `/api/jobs` (runtime `API_BASE_URL`, internal SEO bypass,
 * visitor IP forwarding). Prevents SSR from calling a stale build-time localhost API.
 */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const jobId = id?.trim();
  if (!jobId) {
    return NextResponse.json({ error: "Missing job id", code: "BAD_REQUEST" }, { status: 400 });
  }

  const h = await headers();
  const forwardedFor = h.get("x-forwarded-for") ?? h.get("x-real-ip");

  const upstreamHeaders = new Headers();
  let token: string | null = null;
  if (await hasClerkSessionCookie()) {
    const { getToken } = await auth();
    token = (await getToken()) ?? null;
  }
  const t = token?.trim();
  if (t) upstreamHeaders.set("Authorization", `Bearer ${t}`);

  const xff = forwardedFor?.trim();
  if (xff) upstreamHeaders.set("x-forwarded-for", xff);

  if (!t) {
    const secret = process.env.INTERNAL_SEO_SECRET?.trim();
    if (secret) {
      upstreamHeaders.set("x-internal-seo", "true");
      upstreamHeaders.set("x-internal-seo-secret", secret);
    }
  }

  upstreamHeaders.set("x-ssr-origin", "next-api-proxy");
  upstreamHeaders.set("x-ssr-page", "job-detail");

  for (let attempt = 0; attempt < 3; attempt++) {
    const upstream = new AbortController();
    const upstreamTimeout = setTimeout(() => upstream.abort(), 22_000);
    try {
      const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}`, {
        headers: upstreamHeaders,
        cache: "no-store",
        signal: upstream.signal,
      });
      clearTimeout(upstreamTimeout);
      const body = await res.text();
      const retryable = res.status === 429 || res.status === 503;
      if (retryable && attempt < 2) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      const cacheControl =
        res.status === 404
          ? "private, no-store"
          : t
            ? "private, no-store"
            : "public, s-maxage=300, stale-while-revalidate=600";
      return new NextResponse(body, {
        status: res.status,
        headers: {
          "content-type": res.headers.get("content-type") ?? "application/json",
          "cache-control": cacheControl,
        },
      });
    } catch {
      clearTimeout(upstreamTimeout);
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
    }
  }

  return NextResponse.json(
    { error: "Service temporarily busy", code: "UPSTREAM_TIMEOUT" },
    { status: 503 },
  );
}
