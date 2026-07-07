import { delay, randomIntInclusive } from "../../../utils/common.js";
import { logger } from "../../../utils/logger.js";
import {
  classifyFetchError,
  classifyHttpStatus,
  isRetryableHttpStatus,
  isRetryableWorkdayDetailFailure,
  type WorkdayDetailFailureReason,
} from "./workdayDetailFailure.js";
import {
  recordWorkdayDetailFailure,
  recordWorkdayDetailRetry,
  recordWorkdayDetailSuccess,
} from "./workdayDetailMetrics.js";
import { parseWorkdaySlug } from "../../atsDiscovery/atsUrlParser.js";
import type {
  WorkdayJob,
  WorkdayJobDetailResponse,
  WorkdayRawJob,
  WorkdayToken,
} from "./workday.types.js";

const DETAIL_TIMEOUT_MS = Math.max(
  5_000,
  Math.min(60_000, Number(process.env.WORKDAY_DETAIL_TIMEOUT_MS ?? "15000") || 15_000),
);

const DETAIL_MAX_ATTEMPTS = Math.max(
  1,
  Math.min(5, Number(process.env.WORKDAY_DETAIL_MAX_ATTEMPTS ?? "3") || 3),
);

const DETAIL_BASE_DELAY_MS = Math.max(
  200,
  Math.min(5_000, Number(process.env.WORKDAY_DETAIL_RETRY_BASE_MS ?? "500") || 500),
);

export function buildWorkdayDetailUrl(
  host: string,
  tenant: string,
  site: string,
  externalPath: string,
): string {
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

function backoffDelayMs(attempt: number): number {
  const exp = DETAIL_BASE_DELAY_MS * 2 ** (attempt - 1);
  return exp + randomIntInclusive(0, 250);
}

export type WorkdayDetailFetchResult =
  | {
      ok: true;
      job: WorkdayJob;
      retryCount: number;
    }
  | {
      ok: false;
      reason: WorkdayDetailFailureReason;
      retryCount: number;
      url: string;
    };

async function readResponseBody(res: Response): Promise<{ text: string; empty: boolean }> {
  const text = await res.text();
  return { text, empty: text.trim().length === 0 };
}

/**
 * Fetch CXS job detail with retries on transient failures.
 * Exported for repair worker reuse.
 */
export async function fetchWorkdayJobDetail(
  token: WorkdayToken,
  externalPath: string,
): Promise<WorkdayDetailFetchResult> {
  const ext = externalPath.trim();
  if (!ext) {
    return { ok: false, reason: "no_external_path", retryCount: 0, url: "" };
  }

  const url = buildWorkdayDetailUrl(token.host, token.tenant, token.site, ext);
  let retryCount = 0;

  for (let attempt = 1; attempt <= DETAIL_MAX_ATTEMPTS; attempt++) {
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
        const reason = classifyHttpStatus(res.status);
        if (isRetryableHttpStatus(res.status) && attempt < DETAIL_MAX_ATTEMPTS) {
          retryCount += 1;
          recordWorkdayDetailRetry();
          logger.info(
            {
              event: "workday_detail_retry",
              reason,
              attempt,
              url,
              status: res.status,
            },
            "workday_detail_retry",
          );
          await delay(backoffDelayMs(attempt));
          continue;
        }
        recordWorkdayDetailFailure(reason);
        logger.warn(
          {
            event: "workday_detail_failed",
            reason,
            status: res.status,
            url,
            retryCount,
          },
          "workday_detail_failed",
        );
        return { ok: false, reason, retryCount, url };
      }

      const { text, empty } = await readResponseBody(res);
      if (empty) {
        const reason: WorkdayDetailFailureReason = "empty_body";
        recordWorkdayDetailFailure(reason);
        logger.warn(
          { event: "workday_detail_failed", reason, url, retryCount },
          "workday_detail_failed",
        );
        return { ok: false, reason, retryCount, url };
      }

      let data: WorkdayJobDetailResponse;
      try {
        data = JSON.parse(text) as WorkdayJobDetailResponse;
      } catch {
        const reason: WorkdayDetailFailureReason = "malformed_json";
        recordWorkdayDetailFailure(reason);
        logger.warn(
          { event: "workday_detail_failed", reason, url, retryCount },
          "workday_detail_failed",
        );
        return { ok: false, reason, retryCount, url };
      }

      const info = data.jobPostingInfo;
      if (!info) {
        const reason: WorkdayDetailFailureReason = "no_jobPostingInfo";
        recordWorkdayDetailFailure(reason);
        logger.warn(
          { event: "workday_detail_failed", reason, url, retryCount },
          "workday_detail_failed",
        );
        return { ok: false, reason, retryCount, url };
      }

      const descHtml = (info.jobDescriptionHtml ?? info.jobDescription ?? "").trim();
      if (!descHtml) {
        const reason: WorkdayDetailFailureReason = "empty_description_in_detail";
        recordWorkdayDetailFailure(reason);
        logger.warn(
          { event: "workday_detail_failed", reason, url, retryCount },
          "workday_detail_failed",
        );
        return { ok: false, reason, retryCount, url };
      }

      recordWorkdayDetailSuccess();
      logger.info(
        {
          event: "workday_detail_fetched",
          url,
          description_extracted_length: descHtml.length,
          retryCount,
        },
        "workday_detail_fetched",
      );

      const merged: WorkdayJob = {
        title: info.title?.trim() || undefined,
        jobDescription: descHtml,
        jobDescriptionHtml: info.jobDescriptionHtml?.trim() || undefined,
        locationsText: info.locationsText ?? info.location,
        postedOn: info.postedOn,
        startDate: info.startDate,
        externalUrl: info.externalUrl,
        externalPath: ext,
      };

      return { ok: true, job: merged, retryCount };
    } catch (err) {
      const reason = classifyFetchError(err);
      if (isRetryableWorkdayDetailFailure(reason) && attempt < DETAIL_MAX_ATTEMPTS) {
        retryCount += 1;
        recordWorkdayDetailRetry();
        logger.info(
          {
            event: "workday_detail_retry",
            reason,
            attempt,
            url,
            err: err instanceof Error ? err.message : String(err),
          },
          "workday_detail_retry",
        );
        await delay(backoffDelayMs(attempt));
        continue;
      }
      recordWorkdayDetailFailure(reason);
      logger.warn(
        {
          event: "workday_detail_failed",
          reason,
          url,
          retryCount,
          err: err instanceof Error ? err.message : String(err),
        },
        "workday_detail_failed",
      );
      return { ok: false, reason, retryCount, url };
    }
  }

  return { ok: false, reason: "timeout", retryCount, url };
}

/**
 * Fetches CXS job detail for one listing (list POST does not include full JD HTML).
 * Never silently degrades: failures are classified, logged, and marked recoverable.
 */
export async function enrichWorkdayRawJobWithDetail(raw: WorkdayRawJob): Promise<WorkdayRawJob> {
  const { token, job } = raw;
  if (hasSubstantiveDescription(job)) {
    return {
      ...raw,
      detailEnrichment: { outcome: "skipped_has_description" },
    };
  }

  const ext = (job.externalPath ?? "").trim();
  if (!ext) {
    logger.warn(
      {
        event: "workday_detail_failed",
        reason: "no_external_path",
        tenant: token.tenant,
        site: token.site,
      },
      "workday_detail_failed",
    );
    recordWorkdayDetailFailure("no_external_path");
    return {
      ...raw,
      detailEnrichment: {
        outcome: "failed",
        failureReason: "no_external_path",
        needsRecovery: true,
      },
    };
  }

  const fetched = await fetchWorkdayJobDetail(token, ext);
  if (!fetched.ok) {
    return {
      ...raw,
      detailEnrichment: {
        outcome: "failed",
        failureReason: fetched.reason,
        retryCount: fetched.retryCount,
        needsRecovery: true,
      },
    };
  }

  const info = fetched.job;
  const merged: WorkdayJob = {
    ...job,
    title: info.title?.trim() || job.title,
    jobDescription: info.jobDescription,
    jobDescriptionHtml: info.jobDescriptionHtml,
    locationsText: info.locationsText ?? job.locationsText,
    postedOn: info.postedOn ?? job.postedOn,
    startDate: info.startDate ?? job.startDate,
    externalUrl: info.externalUrl ?? job.externalUrl,
    externalPath: ext,
  };

  return {
    token,
    job: merged,
    detailEnrichment: {
      outcome: "success",
      retryCount: fetched.retryCount,
    },
  };
}

/** Resolve Workday token + externalPath from a stored listing URL for repair flows. */
export function resolveWorkdayDetailContext(
  sourceUrl: string,
  hints?: { atsBoardToken?: string | null; endpointSlug?: string | null },
): { token: WorkdayToken; externalPath: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return null;
  }
  if (!parsed.hostname.toLowerCase().includes("myworkdayjobs.com")) return null;

  let site = "Careers";
  let host = parsed.hostname.toLowerCase();
  let tenant = host.split(".")[0]?.trim() ?? "";

  const tokenHint = hints?.atsBoardToken?.trim();
  if (tokenHint) {
    try {
      const j = JSON.parse(tokenHint) as {
        site?: string;
        host?: string;
        tenant?: string;
      };
      if (typeof j.host === "string" && j.host.trim()) host = j.host.trim().toLowerCase();
      if (typeof j.tenant === "string" && j.tenant.trim()) tenant = j.tenant.trim();
      if (typeof j.site === "string" && j.site.trim()) site = j.site.trim();
    } catch {
      const parts = tokenHint.split("|").map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 3) {
        host = parts[0]!.toLowerCase();
        tenant = parts[1]!;
        site = parts[2]!;
      }
    }
  } else if (hints?.endpointSlug?.trim()) {
    const parsedSlug = parseWorkdaySlug(hints.endpointSlug.trim());
    if (parsedSlug) {
      host = parsedSlug.host.toLowerCase();
      tenant = parsedSlug.tenant;
      site = parsedSlug.site;
    }
  }

  if (!tenant) return null;

  const path = parsed.pathname;
  const jobIdx = path.toLowerCase().indexOf("/job/");
  if (jobIdx === -1) return null;
  const externalPath = path.slice(jobIdx);
  if (!externalPath || externalPath === "/job/") return null;

  return {
    token: { host, tenant, site },
    externalPath,
  };
}