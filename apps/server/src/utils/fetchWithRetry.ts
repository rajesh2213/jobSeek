/** Shared HTTP retry/timeouts for ATS and SERP outbound calls. */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isRetryableFetchError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (!(err instanceof Error)) return false;
  const n = err.name;
  if (n === "AbortError" || n === "TimeoutError") return true;
  const m = err.message.toLowerCase();
  return (
    m.includes("fetch failed") ||
    m.includes("network") ||
    m.includes("econnreset") ||
    m.includes("etimedout") ||
    m.includes("enotfound")
  );
}

export type FetchWithRetryOptions = {
  timeoutMs: number;
  maxAttempts: number;
  baseDelayMs: number;
};

export const DEFAULT_ATS_FETCH_RETRY: FetchWithRetryOptions = {
  timeoutMs: 8_000,
  maxAttempts: 3,
  baseDelayMs: 400,
};

export const DEFAULT_SERP_FETCH_RETRY: FetchWithRetryOptions = {
  timeoutMs: 15_000,
  maxAttempts: 3,
  baseDelayMs: 600,
};

/**
 * fetch() with per-attempt timeout and backoff on retryable failures.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit | undefined,
  opts: FetchWithRetryOptions,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok && isRetryableHttpStatus(res.status) && attempt < opts.maxAttempts) {
        await sleep(opts.baseDelayMs * attempt);
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < opts.maxAttempts && isRetryableFetchError(err)) {
        await sleep(opts.baseDelayMs * attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
