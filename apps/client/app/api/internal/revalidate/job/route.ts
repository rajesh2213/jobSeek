import { NextResponse } from "next/server";
import { revalidateJobDetailCaches } from "../../../../lib/revalidateJobDetail";

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

/** Targeted on-demand ISR invalidation for job detail pages (called from VPS purge worker). */
export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized", code: "REVALIDATE_UNAUTHORIZED" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON", code: "BAD_REQUEST" }, { status: 400 });
  }

  const jobIds = Array.isArray((body as { jobIds?: unknown }).jobIds)
    ? (body as { jobIds: unknown[] }).jobIds.filter((id): id is string => typeof id === "string")
    : [];

  if (jobIds.length === 0) {
    return NextResponse.json({ error: "jobIds required", code: "BAD_REQUEST" }, { status: 400 });
  }

  const revalidated = revalidateJobDetailCaches(jobIds);
  return NextResponse.json({ ok: true, revalidated: revalidated.length });
}
