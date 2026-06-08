import { NextResponse } from "next/server";

export function sitemapXmlResponse(xml: string): NextResponse {
  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
