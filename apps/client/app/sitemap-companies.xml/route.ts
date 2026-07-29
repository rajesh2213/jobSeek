import { getCompanySitemapEntries } from "../../lib/sitemap/generate";
import { buildUrlsetXml } from "../../lib/sitemap/xml";
import { sitemapXmlResponse } from "../../lib/sitemap/routeResponse";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const { entries } = await getCompanySitemapEntries();
  return sitemapXmlResponse(buildUrlsetXml(entries));
}
