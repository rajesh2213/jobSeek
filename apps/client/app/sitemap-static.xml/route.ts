import { getStaticSitemapEntries } from "../../lib/sitemap/generate";
import { buildUrlsetXml } from "../../lib/sitemap/xml";
import { sitemapXmlResponse } from "../../lib/sitemap/routeResponse";

export const runtime = "nodejs";

export async function GET() {
  const entries = await getStaticSitemapEntries();
  return sitemapXmlResponse(buildUrlsetXml(entries));
}
