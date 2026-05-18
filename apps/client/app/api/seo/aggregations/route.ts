import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { fetchSeoAggregations } from "../../../../lib/api";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * Server-side proxy for market insights. Keeps INTERNAL_SEO_SECRET off the browser
 * while allowing client hydration when SSR aggregation times out (cold Redis cache).
 */
export async function GET(req: NextRequest) {
  const filters = req.nextUrl.searchParams.get("filters")?.trim() ?? "";
  if (!filters) {
    return NextResponse.json({
      data: {
        topSkills: [],
        topCompanies: [],
        salary: { avg: null, min: null, max: null },
        hiringTrend: [],
      },
    });
  }

  try {
    const data = await fetchSeoAggregations({
      filtersSlug: filters,
      internalSeoSecret: process.env.INTERNAL_SEO_SECRET ?? null,
    });
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json(
      {
        data: {
          topSkills: [],
          topCompanies: [],
          salary: { avg: null, min: null, max: null },
          hiringTrend: [],
        },
      },
      { status: 200 },
    );
  }
}
