import { buildSitemapIndexXml } from "../../lib/sitemap/xml";
import { buildSitemapIndexLocations } from "../../lib/sitemap/generate";
import { sitemapXmlResponse } from "../../lib/sitemap/routeResponse";

export const runtime = "nodejs";
/** Building the index triggers full job-set generation; allow headroom over the default limit. */
export const maxDuration = 60;

export async function GET() {
  const locations = await buildSitemapIndexLocations();
  const xml = buildSitemapIndexXml(locations, new Date());
  return sitemapXmlResponse(xml);
}
