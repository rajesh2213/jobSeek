/**
 * Shared HTML fetch used by enrichment and debug tooling (same timeout/headers as enrichment).
 */
export type FetchHtmlMeta =
  | { html: string; fetched: true; error?: undefined; htmlLength: number }
  | { html: null; fetched: false; error?: string; htmlLength: number };

export async function fetchCareersHtmlWithMeta(
  url: string,
  timeoutMs = 10_000,
): Promise<FetchHtmlMeta> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "text/html,*/*" },
      redirect: "follow",
    });
    if (!res.ok) {
      return { html: null, fetched: false, error: `HTTP ${res.status}`, htmlLength: 0 };
    }
    const html = await res.text();
    return { html, fetched: true, htmlLength: html.length };
  } catch (e) {
    return {
      html: null,
      fetched: false,
      error: e instanceof Error ? e.message : String(e),
      htmlLength: 0,
    };
  }
}

export async function fetchCareersHtml(url: string): Promise<string | null> {
  const r = await fetchCareersHtmlWithMeta(url);
  return r.html;
}
