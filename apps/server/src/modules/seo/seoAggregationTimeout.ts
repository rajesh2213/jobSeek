export function aggregationQueryTimeoutMs(): number {
  const raw = process.env.SEO_AGGREGATION_QUERY_TIMEOUT_MS?.trim();
  if (!raw) return 3000;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 3000;
  return Math.max(1000, Math.min(parsed, 8000));
}

export async function withAggregationTimeout<T>(
  promise: Promise<T>,
  timeoutMs = aggregationQueryTimeoutMs(),
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("SEO_AGGREGATION_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
