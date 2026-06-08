import { buildSitemapIndexXml } from "../../lib/sitemap/xml";
import { buildSitemapIndexLocations } from "../../lib/sitemap/generate";
import { sitemapXmlResponse } from "../../lib/sitemap/routeResponse";

export const runtime = "nodejs";

export async function GET() {
  const locations = await buildSitemapIndexLocations();
  const xml = buildSitemapIndexXml(locations, new Date());
  return sitemapXmlResponse(xml);
}
