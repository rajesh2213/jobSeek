import { logger } from "../../../utils/logger.js";
import type {
  WorkdayJob,
  WorkdayJobDetailResponse,
  WorkdayRawJob,
} from "./workday.types.js";

const DETAIL_TIMEOUT_MS = 15_000;

function buildWorkdayDetailUrl(host: string, tenant: string, site: string, externalPath: string): string {
  const ext = externalPath.trim();
  const suffix = ext.startsWith("/") ? ext : `/${ext}`;
  return `https://${host}/wday/cxs/${tenant}/${site}${suffix}`;
}

function hasSubstantiveDescription(job: WorkdayJob): boolean {
  const j = job as Record<string, unknown>;
  const html =
    typeof j.jobDescriptionHtml === "string"
      ? j.jobDescriptionHtml
      : typeof j.jobDescription === "string"
        ? j.jobDescription
        : "";
  return html.trim().length > 80;
}

/**
 * Fetches CXS job detail for one listing (list POST does not include full JD HTML).
 * Merges `locationsText` / `location` from detail when the list response omitted them (see merged job below).
 */
export async function enrichWorkdayRawJobWithDetail(raw: WorkdayRawJob): Promise<WorkdayRawJob> {
  const { token, job } = raw;
  if (hasSubstantiveDescription(job)) {
    return raw;
  }

  const ext = (job.externalPath ?? "").trim();
  if (!ext) {
    logger.warn(
      {
        event: "workday_description_missing",
        reason: "no_external_path",
        tenant: token.tenant,
        site: token.site,
      },
      "Workday listing missing externalPath; cannot fetch detail",
    );
    return raw;
  }

  const url = buildWorkdayDetailUrl(token.host, token.tenant, token.site, ext);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        referer: `https://${token.host}/`,
      },
      signal: AbortSignal.timeout(DETAIL_TIMEOUT_MS),
    });

    if (!res.ok) {
      logger.warn(
        {
          event: "workday_description_missing",
          reason: `http_${res.status}`,
          url,
        },
        "Workday job detail request failed",
      );
      return raw;
    }

    const data = (await res.json()) as WorkdayJobDetailResponse;
    const info = data.jobPostingInfo;
    if (!info) {
      logger.warn(
        { event: "workday_description_missing", reason: "no_jobPostingInfo", url },
        "Workday detail JSON missing jobPostingInfo",
      );
      return raw;
    }

    const descHtml = (info.jobDescriptionHtml ?? info.jobDescription ?? "").trim();
    if (!descHtml) {
      logger.warn(
        { event: "workday_description_missing", reason: "empty_description_in_detail", url },
        "Workday detail had no job description body",
      );
      return raw;
    }

    logger.info(
      {
        event: "workday_detail_fetched",
        url,
        description_extracted_length: descHtml.length,
      },
      "Workday job detail merged into listing",
    );

    const merged: WorkdayJob = {
      ...job,
      title: info.title?.trim() || job.title,
      jobDescription: descHtml,
      jobDescriptionHtml: info.jobDescriptionHtml?.trim() || undefined,
      locationsText: info.locationsText ?? info.location ?? job.locationsText,
      postedOn: info.postedOn ?? job.postedOn,
      startDate: info.startDate ?? job.startDate,
      externalUrl: info.externalUrl ?? job.externalUrl,
    };

    return { token, job: merged };
  } catch (err) {
    logger.warn(
      {
        event: "workday_description_missing",
        reason: err instanceof Error ? err.message : "fetch_error",
        url,
      },
      "Workday job detail fetch threw",
    );
    return raw;
  }
}
