import { NextResponse } from "next/server";
import { revalidateSitemapCaches } from "../../../../../lib/revalidateSitemap";

export const runtime = "nodejs";

function isAuthorized(request: Request): boolean {
  const marker = request.headers.get("x-internal-seo");
  const secret = request.headers.get("x-internal-seo-secret");
  const expected = process.env.INTERNAL_SEO_SECRET?.trim();
  return (
    marker === "true" &&
    typeof secret === "string" &&
    Boolean(expected) &&
    secret === expected
  );
}

/** On-demand ISR invalidation for sitemap caches (called from repair worker / ingest hooks). */
export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: "Unauthorized", code: "REVALIDATE_UNAUTHORIZED" },
      { status: 401 },
    );
  }

  const tags = revalidateSitemapCaches();
  return NextResponse.json({ ok: true, revalidated: tags });
}
