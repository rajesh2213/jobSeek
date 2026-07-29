import {
  getJobSitemapEntries,
  partitionJobEntries,
  jobPartitionCount,
} from "../../../lib/sitemap/generate";
import { buildUrlsetXml } from "../../../lib/sitemap/xml";
import { sitemapXmlResponse } from "../../../lib/sitemap/routeResponse";

export const runtime = "nodejs";
/** Cold generation walks the full indexable job feed; allow headroom over the default limit. */
export const maxDuration = 90;

type Params = { partition: string };

export async function GET(
  _request: Request,
  context: { params: Promise<Params> },
) {
  const { partition: raw } = await context.params;
  const partition = Number.parseInt(raw, 10);
  if (!Number.isFinite(partition) || partition < 1) {
    return new Response("Not found", { status: 404 });
  }

  const { entries: allJobs } = await getJobSitemapEntries();
  const maxPartition = jobPartitionCount(allJobs.length);
  if (partition > maxPartition || maxPartition === 0) {
    return new Response("Not found", { status: 404 });
  }

  const entries = partitionJobEntries(allJobs)[partition - 1] ?? [];
  return sitemapXmlResponse(buildUrlsetXml(entries));
}
