/** Classified failure reasons for Workday CXS job-detail fetches. */
export type WorkdayDetailFailureReason =
  | "timeout"
  | "http_429"
  | "http_403"
  | "http_404"
  | "http_other"
  | "parse_failure"
  | "empty_body"
  | "malformed_json"
  | "no_jobPostingInfo"
  | "empty_description_in_detail"
  | "no_external_path"
  | "network_error";

export function isRetryableWorkdayDetailFailure(
  reason: WorkdayDetailFailureReason,
): boolean {
  return (
    reason === "timeout" ||
    reason === "http_429" ||
    reason === "network_error" ||
    reason === "http_other"
  );
}

/** Worker: retry same run only for transient detail failures. */
export function isRetryableWorkdayRepairFailure(reason: string): boolean {
  return isRetryableWorkdayDetailFailure(reason as WorkdayDetailFailureReason);
}

/**
 * Retry matrix:
 * - Retry: timeout, network_error, http_429, http_5xx (http_other)
 * - No retry: http_403, http_404, empty_body, malformed_json, no_jobPostingInfo,
 *   empty_description_in_detail, no_external_path, parse_failure
 */
export function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function classifyHttpStatus(status: number): WorkdayDetailFailureReason {
  if (status === 429) return "http_429";
  if (status === 403) return "http_403";
  if (status === 404) return "http_404";
  if (status >= 500) return "http_other";
  return "http_other";
}

export function classifyFetchError(err: unknown): WorkdayDetailFailureReason {
  if (err instanceof Error) {
    const name = err.name;
    const m = err.message.toLowerCase();
    if (
      name === "AbortError" ||
      name === "TimeoutError" ||
      m.includes("timeout") ||
      m.includes("timed out")
    ) {
      return "timeout";
    }
    if (
      name === "TypeError" ||
      m.includes("fetch failed") ||
      m.includes("network") ||
      m.includes("econnreset") ||
      m.includes("enotfound")
    ) {
      return "network_error";
    }
  }
  return "network_error";
}
